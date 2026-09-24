CREATE TABLE "demo_room_seats" (
	"room_id" varchar(16) NOT NULL,
	"slot" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "demo_room_seats_room_id_slot_pk" PRIMARY KEY("room_id","slot"),
	CONSTRAINT "demo_room_seats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "demo_rooms" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "demo_rooms_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "presence_connections" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"avatar_url" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo_room_id" varchar(16);--> statement-breakpoint
ALTER TABLE "demo_room_seats" ADD CONSTRAINT "demo_room_seats_room_id_demo_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."demo_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_room_seats" ADD CONSTRAINT "demo_room_seats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_rooms" ADD CONSTRAINT "demo_rooms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_rooms" ADD CONSTRAINT "demo_rooms_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_connections" ADD CONSTRAINT "presence_connections_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_connections" ADD CONSTRAINT "presence_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_rooms_expires_idx" ON "demo_rooms" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "presence_board_seen_idx" ON "presence_connections" USING btree ("board_id","seen_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_demo_room_id_demo_rooms_id_fk" FOREIGN KEY ("demo_room_id") REFERENCES "public"."demo_rooms"("id") ON DELETE cascade ON UPDATE no action;