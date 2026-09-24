import { TRPCError, initTRPC } from "@trpc/server";
import { eq } from "drizzle-orm";
import superjson from "superjson";
import { z } from "zod";
import { requireAccess, type Access, type AccessMode, type AccessScope } from "~/server/api/authz";
import { getSessionFromCookieHeader, type Session } from "~/server/auth/session";
import { db, type Database } from "~/server/db";
import { users } from "~/server/db/schema";
import {
  RATE_LIMIT_POLICIES,
  RateLimitError,
  getRateLimiter,
  type RateLimitPolicyName,
  type RateLimiter,
} from "~/server/rate-limit/token-bucket";
import { getEventBus, type EventBus } from "~/server/realtime/event-bus";
import { getPresenceStore, type PresenceStore } from "~/server/realtime/presence-store";

/* ───────────────────────────── Context ───────────────────────────── */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * HTTP requests hand us the raw cookie header; the WebSocket server has
 * ALREADY verified the session during the upgrade handshake and passes it in,
 * so the token isn't parsed twice.
 */
export type CreateContextOptions = { cookieHeader: string | null | undefined } | { session: Session | null };

export interface Context {
  db: Database;
  bus: EventBus;
  presence: PresenceStore;
  rateLimiter: RateLimiter;
  session: Session | null;
  /** Loads (and briefly caches) the session's user row. See `isAuthed`. */
  loadUser: () => Promise<AuthUser | null>;
}

/**
 * HTTP contexts live for one request; a WS context lives as long as the
 * socket (hours). A short TTL on the user lookup means a deleted/banned user
 * loses access to NEW operations on an open socket within a minute, without a
 * DB round-trip on every subscription message.
 */
const USER_CACHE_TTL_MS = 60_000;

export async function createTRPCContext(opts: CreateContextOptions): Promise<Context> {
  const session = "session" in opts ? opts.session : await getSessionFromCookieHeader(opts.cookieHeader);

  let cached: { user: AuthUser | null; at: number } | null = null;
  const loadUser = async (): Promise<AuthUser | null> => {
    if (!session) return null;
    if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.user;
    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    cached = { user: user ?? null, at: Date.now() };
    return cached.user;
  };

  return {
    db,
    bus: getEventBus(),
    presence: getPresenceStore(db),
    rateLimiter: getRateLimiter(),
    session,
    loadUser,
  };
}

/* ───────────────────────────── tRPC init ───────────────────────────── */

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Field-level Zod errors reach the client fully typed.
        zodError: error.cause instanceof z.ZodError ? z.flattenError(error.cause) : null,
        // Lets the client show "try again in 3s" instead of a generic failure.
        retryAfterMs: error.cause instanceof RateLimitError ? error.cause.result.retryAfterMs : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/* ───────────────────────────── Middleware ───────────────────────────── */

/**
 * `isAuthed` — authentication.
 *  1. A session must be present (valid signature, issuer, audience).
 *  2. It must not have expired *now*. The JWT library checked `exp` when the
 *     token was parsed, but a WebSocket context can outlive the token by days.
 *  3. The user must still exist — a valid token for a deleted account is rejected.
 * Downstream resolvers get a non-null `ctx.session` and a loaded `ctx.user`.
 */
const isAuthed = t.middleware(async ({ ctx, next }) => {
  const { session } = ctx;
  if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
  if (session.expiresAt <= Date.now()) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Your session has expired" });
  }
  const user = await ctx.loadUser();
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "This account no longer exists" });
  return next({ ctx: { session, user } });
});

/**
 * Token-bucket limit keyed by (policy, user). Must run AFTER `isAuthed`, so
 * anonymous traffic is rejected before it can consume anyone's budget.
 *
 * Fails OPEN if the limiter backend is down: a Redis blip should degrade
 * abuse protection, not take the whole write path offline.
 */
export function rateLimit(policyName: RateLimitPolicyName) {
  return t.middleware(async ({ ctx, next }) => {
    const userId = ctx.session?.userId;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    let result;
    try {
      result = await ctx.rateLimiter.consume(`${policyName}:${userId}`, RATE_LIMIT_POLICIES[policyName]);
    } catch (err) {
      console.error(`[rate-limit] ${policyName} limiter unavailable — failing open`, err);
      return next();
    }

    if (!result.allowed) {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `You're going a bit fast — try again in ${seconds}s`,
        cause: new RateLimitError(result),
      });
    }
    return next();
  });
}

/* ───────────────────────────── Procedures ───────────────────────────── */

/** Any signed-in, existing user. */
export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * Authorization — "does this user belong to the workspace that owns the thing
 * they're touching?" Each builder declares the id it needs as input, resolves it
 * to a workspace in one query, and exposes `ctx.access` to the resolver.
 * A resolver built on these physically cannot forget the tenant check.
 */
/**
 * Membership check + the session's workspace LOCK. A demo-room session carries
 * `workspaceId` in its signed cookie and can never act outside that room, even
 * if the user row were somehow granted another membership.
 */
async function scopedAccess(
  ctx: { db: Database; user: AuthUser; session: Session },
  scope: AccessScope,
  mode: AccessMode,
): Promise<Access> {
  const access = await requireAccess(ctx.db, ctx.user.id, scope, mode);
  if (ctx.session.workspaceId && ctx.session.workspaceId !== access.workspaceId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This session is limited to its demo room" });
  }
  return access;
}

export const workspaceProcedure = (mode: AccessMode = "read") =>
  protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .use(async ({ ctx, input, next }) =>
      next({ ctx: { access: await scopedAccess(ctx, { workspaceId: input.workspaceId }, mode) } }),
    );

export const boardProcedure = (mode: AccessMode = "read") =>
  protectedProcedure
    .input(z.object({ boardId: z.uuid() }))
    .use(async ({ ctx, input, next }) =>
      next({ ctx: { access: await scopedAccess(ctx, { boardId: input.boardId }, mode) } }),
    );

export const columnProcedure = (mode: AccessMode = "read") =>
  protectedProcedure
    .input(z.object({ columnId: z.uuid() }))
    .use(async ({ ctx, input, next }) =>
      next({ ctx: { access: await scopedAccess(ctx, { columnId: input.columnId }, mode) } }),
    );

export const taskProcedure = (mode: AccessMode = "read") =>
  protectedProcedure
    .input(z.object({ taskId: z.uuid() }))
    .use(async ({ ctx, input, next }) =>
      next({ ctx: { access: await scopedAccess(ctx, { taskId: input.taskId }, mode) } }),
    );

/** Narrows `access.boardId` for board/column/task scopes, where it is always set. */
export function boardIdOf(access: Access): string {
  if (!access.boardId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scope has no board" });
  return access.boardId;
}
