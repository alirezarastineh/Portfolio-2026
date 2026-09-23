CREATE TABLE "media_variants" (
	"asset_id" uuid NOT NULL,
	"format" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	CONSTRAINT "media_variants_asset_id_format_width_pk" PRIMARY KEY("asset_id","format","width"),
	CONSTRAINT "media_variants_filename_unique" UNIQUE("filename"),
	CONSTRAINT "media_variants_format_check" CHECK ("media_variants"."format" in ('webp', 'avif'))
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "blur_data_uri" text;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_check" CHECK ("media_assets"."kind" in ('image', 'document'));