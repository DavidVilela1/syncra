import { and, eq } from "drizzle-orm";
import {
  ArrowUpRight,
  Boxes,
  CircleAlert,
  Clock3,
  Link2,
  Lock,
  MousePointerClick,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { BoardPreview } from "~/components/landing/board-preview";
import { CreateRoomButton } from "~/components/landing/create-room-button";
import { LegalLink } from "~/components/legal/legal-dialog";
import { LogoMark } from "~/components/shell/app-sidebar";
import { PERSONAS, ROOM_CAPACITY, type Persona } from "~/lib/personas";
import { SESSION_COOKIE, verifySession } from "~/server/auth/session";
import { db } from "~/server/db";
import { demoRoomSeats } from "~/server/db/schema";
import { isRoomId } from "~/server/demo/room-id";
import { findActiveRoom } from "~/server/demo/rooms";

export const metadata: Metadata = {
  title: { absolute: "Syncra — Where engineering meets real-time velocity" },
  description:
    "A real-time, multiplayer Kanban built with end-to-end type safety, O(1) fractional indexing and optimistic UI. Spin up a live demo room and share the link.",
};

/** `?error=` codes set by /api/auth/demo and the proxy, mapped to human copy. */
const ERRORS: Record<string, (room: string | null) => string> = {
  rate_limited: () => "Lots of rooms were just created from your network — give it a minute and try again.",
  create_failed: () => "We couldn’t spin up a room just now. Please try again.",
  invalid_room: () => "That invite link looks malformed. Ask for a fresh one, or start your own room.",
  room_expired: () => "That demo room has expired. Rooms clean themselves up after 24 hours of inactivity.",
  room_full: (room) =>
    `Room ${room ?? ""} is full — all ${ROOM_CAPACITY} teammates are online right now. Start your own room instead.`,
  signed_out: () => "Your session ended. Start a new demo room to jump back in.",
};

type Resume = { roomId: string; persona: Persona } | null;

/** If the visitor already sits in a live room, offer to take them straight back. */
async function resumableRoom(): Promise<Resume> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roomId || !isRoomId(session.roomId)) return null;

  const room = await findActiveRoom(db, session.roomId);
  if (!room || room.workspaceId !== session.workspaceId) return null;

  const [seat] = await db
    .select({ slot: demoRoomSeats.slot })
    .from(demoRoomSeats)
    .where(and(eq(demoRoomSeats.roomId, room.id), eq(demoRoomSeats.userId, session.userId)))
    .limit(1);
  const persona = seat ? PERSONAS[seat.slot] : undefined;
  return persona ? { roomId: room.id, persona } : null;
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : null;
  const errorRoom = typeof params.room === "string" ? params.room : null;
  const errorMessage = errorCode ? ERRORS[errorCode]?.(errorRoom) : undefined;
  const resume = await resumableRoom();

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#09090b] text-zinc-400">
      {/* ── Ambient backdrop ─────────────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute inset-0 bg-dot-grid [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute -top-48 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.14] blur-[120px]" />
        <div className="absolute left-[8%] top-[620px] h-72 w-72 rounded-full bg-neon/[0.05] blur-[100px]" />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090b]/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[15px] font-semibold tracking-tight text-white">Syncra</span>
          </Link>
          <div className="hidden items-center gap-7 text-[13px] md:flex">
            <a href="#features" className="transition-colors duration-200 hover:text-white">
              Architecture
            </a>
            <a href="#how-it-works" className="transition-colors duration-200 hover:text-white">
              How the demo works
            </a>
          </div>
          {resume ? (
            <Link
              href={`/dashboard?room=${resume.roomId}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] text-zinc-200 transition-all duration-200 hover:border-accent/40 hover:bg-accent-soft"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resume.persona.avatarUrl} alt="" className="size-5 rounded-full" />
              Back to room
            </Link>
          ) : (
            <CreateRoomButton size="md" label="Try it live" />
          )}
        </nav>
      </header>

      <main className="relative z-10">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          {errorMessage && (
            <div
              role="alert"
              className="mx-auto mb-10 flex max-w-xl animate-slide-up items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-[13px] text-rose-200"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-400" />
              <p>{errorMessage}</p>
            </div>
          )}

          <div className="mx-auto max-w-3xl text-center">
            <a
              href="#how-it-works"
              className="group inline-flex animate-fade-in items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1.5 pr-3 text-xs text-zinc-300 transition-all duration-200 hover:border-accent/40"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neon/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neon">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-neon opacity-70" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-neon" />
                </span>
                Live
              </span>
              Multiplayer demo rooms — no sign-up
              <ArrowUpRight className="size-3.5 text-zinc-500 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" />
            </a>

            <h1 className="mt-7 animate-slide-up text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.035em] text-white sm:text-6xl lg:text-7xl">
              Where engineering meets{" "}
              {/* nowrap keeps "real-time" from splitting at its hyphen on narrow widths */}
              <span className="bg-gradient-to-br from-violet-300 via-accent to-fuchsia-400 bg-clip-text text-transparent">
                <span className="whitespace-nowrap">real-time</span> velocity
              </span>
              .
            </h1>

            <p className="mx-auto mt-6 max-w-xl animate-slide-up text-pretty text-[16px] leading-7 text-zinc-400 [animation-delay:80ms]">
              Syncra is a collaborative Kanban engineered like infrastructure: typed from database to pixel, one-row
              writes per drag, and every move mirrored to your team the instant it happens.
            </p>

            <div className="mt-9 flex animate-slide-up flex-col items-center justify-center gap-3 [animation-delay:140ms] sm:flex-row">
              <CreateRoomButton />
              {resume ? (
                <Link
                  href={`/dashboard?room=${resume.roomId}`}
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-5 text-[14px] text-zinc-200 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={resume.persona.avatarUrl} alt="" className="size-5 rounded-full" />
                  Resume as {resume.persona.name.split(" ")[0]}
                  <span className="font-mono text-[11px] text-zinc-500">{resume.roomId}</span>
                </Link>
              ) : (
                <a
                  href="#how-it-works"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-5 text-[14px] text-zinc-200 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06]"
                >
                  How it works
                </a>
              )}
            </div>

            <ConsentNote />

            <p className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <Boxes className="size-3.5" /> private sandbox per room
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" /> up to {ROOM_CAPACITY} people
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" /> auto-expires after 24h idle
              </span>
            </p>
          </div>

          <div className="relative mt-16 animate-slide-up [animation-delay:220ms]">
            <BoardPreview />
          </div>
        </section>

        {/* ── Proof strip ───────────────────────────────────────────── */}
        <section aria-label="Engineering facts" className="border-y border-white/[0.06] bg-white/[0.01]">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-white/[0.06] px-4 sm:px-6 md:grid-cols-4 md:divide-x">
            <Stat value="1 row" label="written per drag, at any column size" />
            <Stat value="0 any" label="types across client, API and database" />
            <Stat value="≤10s" label="to evict a dead connection from presence" />
            <Stat value="1 URL" label="to pull a teammate into your live room" />
          </dl>
        </section>

        {/* ── Bento: architecture ───────────────────────────────────── */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="Architecture"
            title="Built like infrastructure, felt like magic."
            body="Every interaction you’ll try in the demo is backed by a deliberate engineering decision."
          />

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            <BentoCard
              className="md:col-span-2"
              icon={<ShieldCheck className="size-4" />}
              title="End-to-end type safety"
              body="tRPC infers the API contract straight from the Drizzle schema. Rename a column and the compiler flags every component that reads it — no codegen, no drift."
            >
              <CodeWindow filename="kanban-grid.tsx">
                <Line>
                  <K>const</K> board = <F>useQuery</F>(trpc.board.byId.<F>queryOptions</F>({"{ boardId }"}));
                </Line>
                <Line dim>
                  {"//"} <span className="rounded bg-accent/15 px-1 text-violet-300">board.data</span>
                  {": { columns: { tasks: { number: number; priority: \"urgent\" | … }[] }[] }"}
                </Line>
                <Line>
                  board.data.columns[<N>0</N>].tasks[<N>0</N>].<span className="underline decoration-rose-400 decoration-wavy underline-offset-4">prioirty</span>
                </Line>
                <Line dim>
                  <span className="text-rose-400/90">{"// ✖ Property 'prioirty' does not exist. Did you mean 'priority'?"}</span>
                </Line>
              </CodeWindow>
            </BentoCard>

            <BentoCard
              icon={<Zap className="size-4" />}
              title="O(1) fractional indexing"
              body="Positions are sortable strings. Dropping a card between two others writes one key — never a renumbering cascade."
            >
              <div className="flex items-center justify-center gap-2 py-4 font-mono text-[12px]">
                <KeyChip>a0</KeyChip>
                <span className="text-zinc-700">&lt;</span>
                <KeyChip active>a0V</KeyChip>
                <span className="text-zinc-700">&lt;</span>
                <KeyChip>a1</KeyChip>
              </div>
              <p className="text-center font-mono text-[10.5px] text-zinc-600">UPDATE tasks SET position = &apos;a0V&apos; — 1 row</p>
            </BentoCard>

            <BentoCard
              icon={<Sparkles className="size-4" />}
              title="Advanced optimistic UI"
              body="The card lands before the network round-trip. In-flight refetches are cancelled, and a failure rolls back only the move that failed."
            >
              <ol className="space-y-2 py-2 font-mono text-[11px]">
                <Timeline dot="bg-accent" label="t = 0" text="card painted in its new slot" />
                <Timeline dot="bg-neon" label="t + RTT" text="server key reconciled" />
                <Timeline dot="bg-rose-400" label="on error" text="surgical rollback + resync" />
              </ol>
            </BentoCard>

            <BentoCard
              className="md:col-span-2"
              icon={<Lock className="size-4" />}
              title="Concurrent locking"
              body="Two people dropping into the same gap at the same millisecond? The destination column row is locked, writers are serialised, and both cards land in a correct, stable order."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <CodeWindow filename="task.moveTask">
                  <Line>
                    <K>SELECT</K> id <K>FROM</K> columns
                  </Line>
                  <Line>
                    <K>WHERE</K> id = $1 <K>FOR UPDATE</K>;
                  </Line>
                  <Line dim>{"-- lock order: column → task (deadlock-free)"}</Line>
                </CodeWindow>
                <div className="flex flex-col justify-center gap-2 rounded-xl border border-white/[0.06] bg-canvas/60 p-3 font-mono text-[11px]">
                  <LockRow who="Alice" status="acquired" tone="text-neon" />
                  <LockRow who="Bruno" status="waits for lock" tone="text-amber-300" />
                  <LockRow who="Bruno" status="acquired → a0l" tone="text-neon" />
                </div>
              </div>
            </BentoCard>
          </div>
        </section>

        {/* ── How the demo room works ───────────────────────────────── */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
          <SectionHeading
            eyebrow="Live demo rooms"
            title="Send one link. Build together in seconds."
            body="Each room is a real, isolated workspace in Postgres — not a mock. Invitees are seated as the next free teammate, automatically."
          />

          <ol className="mt-14 grid gap-4 md:grid-cols-3">
            <Step
              n={1}
              icon={<MousePointerClick className="size-4" />}
              title="Create a room"
              body="A private workspace, board and six-person cast are provisioned in a single transaction. You’re seated as Alice."
            />
            <Step
              n={2}
              icon={<Link2 className="size-4" />}
              title="Share the link"
              body="Hit “Share session” in the header. Whoever opens it is given the next seat that isn’t live — Bruno, then Chen…"
            />
            <Step
              n={3}
              icon={<Radio className="size-4" />}
              title="Move cards together"
              body="Drags, new cards and presence stream over WebSockets. Rooms are sealed off from each other at every layer."
            />
          </ol>

          <div className="mt-6 rounded-2xl border border-white/[0.06] bg-surface/50 p-5">
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-600">The cast — seated in join order</p>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {PERSONAS.map((p) => (
                <li
                  key={p.handle}
                  className="flex items-center gap-2.5 rounded-xl border border-white/[0.05] bg-canvas/50 p-2.5 transition-all duration-200 hover:border-accent/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.avatarUrl} alt="" className="size-8 rounded-full" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-zinc-200">{p.name.split(" ")[0]}</p>
                    <p className="truncate font-mono text-[10px] text-zinc-600">seat {p.slot + 1}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Final CTA ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#16121f] to-[#0c0b10] px-6 py-16 text-center">
            <div aria-hidden className="absolute inset-0 bg-dot-grid opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
            <div aria-hidden className="absolute left-1/2 top-0 h-40 w-2/3 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" />
            <div className="relative">
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                See it sync. Bring a friend.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-[15px] text-zinc-400">
                Open a room, send the link, and drag a card while they watch it move.
              </p>
              <div className="mt-8 flex justify-center">
                <CreateRoomButton />
              </div>
              <ConsentNote />
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-zinc-600 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <LogoMark className="size-6" />
            <span>Syncra — Next.js · tRPC · Drizzle · PostgreSQL · WebSockets</span>
          </div>
          <nav aria-label="Legal" className="flex items-center gap-4">
            <LegalLink doc="privacy">Privacy Policy</LegalLink>
            <LegalLink doc="terms">Terms of Service</LegalLink>
            <span className="hidden font-mono text-zinc-700 lg:inline">Demo rooms are public to anyone with the link.</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────────── Building blocks ───────────────────────────── */

/** Creating a room is the moment of consent, so the terms sit right under the button. */
function ConsentNote() {
  return (
    <p className="mt-4 text-[12px] text-zinc-600">
      By creating a room you agree to the{" "}
      <LegalLink doc="terms" className="text-zinc-400 underline decoration-white/20">
        Terms of Service
      </LegalLink>{" "}
      and{" "}
      <LegalLink doc="privacy" className="text-zinc-400 underline decoration-white/20">
        Privacy Policy
      </LegalLink>
      .
    </p>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-7 text-center md:px-6">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="block font-mono text-2xl font-medium tracking-tight text-white">{value}</span>
        <span className="mt-1 block text-xs text-zinc-500">{label}</span>
      </dd>
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-pretty text-[15px] leading-7 text-zinc-400">{body}</p>
    </div>
  );
}

function BentoCard({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-surface/60 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_24px_60px_-30px_rgba(139,92,246,0.55)] ${className ?? ""}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-48 rounded-full bg-accent/0 blur-3xl transition-all duration-500 group-hover:bg-accent/15"
      />
      <div className="relative">
        <span className="inline-flex size-8 items-center justify-center rounded-lg border border-accent/25 bg-accent-soft text-violet-300">
          {icon}
        </span>
        <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-white">{title}</h3>
        <p className="mt-2 max-w-prose text-[13.5px] leading-6 text-zinc-400">{body}</p>
        <div className="mt-5">{children}</div>
      </div>
    </article>
  );
}

function CodeWindow({ filename, children }: { filename: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-canvas/80">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2">
        <span className="size-2 rounded-full bg-white/10" />
        <span className="font-mono text-[10.5px] text-zinc-500">{filename}</span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-6 text-zinc-300">{children}</pre>
    </div>
  );
}

function Line({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return <div className={dim ? "text-zinc-600" : undefined}>{children}</div>;
}
function K({ children }: { children: ReactNode }) {
  return <span className="text-violet-400">{children}</span>;
}
function F({ children }: { children: ReactNode }) {
  return <span className="text-sky-300">{children}</span>;
}
function N({ children }: { children: ReactNode }) {
  return <span className="text-amber-300">{children}</span>;
}

function KeyChip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={
        active
          ? "rounded-lg border border-accent/50 bg-accent/15 px-2.5 py-1.5 text-violet-200 shadow-[0_0_20px_-4px_rgba(139,92,246,0.7)]"
          : "rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-zinc-400"
      }
    >
      {children}
    </span>
  );
}

function Timeline({ dot, label, text }: { dot: string; label: string; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="w-16 shrink-0 text-zinc-500">{label}</span>
      <span className="text-zinc-300">{text}</span>
    </li>
  );
}

function LockRow({ who, status, tone }: { who: string; status: string; tone: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
      <span className="text-zinc-300">{who}</span>
      <span className={tone}>{status}</span>
    </div>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: ReactNode; title: string; body: string }) {
  return (
    <li className="relative rounded-2xl border border-white/[0.07] bg-surface/60 p-6 transition-all duration-200 hover:border-accent/30">
      <div className="flex items-center justify-between">
        <span className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300">
          {icon}
        </span>
        <span className="font-mono text-[11px] text-zinc-700">0{n}</span>
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-white">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-6 text-zinc-400">{body}</p>
    </li>
  );
}
