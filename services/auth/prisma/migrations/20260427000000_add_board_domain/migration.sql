-- CreateEnum
CREATE TYPE "BoardAudience" AS ENUM ('ALL', 'DEPARTMENT', 'ROLE');

-- CreateTable
CREATE TABLE "board_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "write_roles" TEXT[],
    "read_audience" "BoardAudience" NOT NULL DEFAULT 'ALL',
    "audience_target_id" TEXT,
    "allow_comments" BOOLEAN NOT NULL DEFAULT true,
    "allow_attachments" BOOLEAN NOT NULL DEFAULT true,
    "post_pinnable" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_posts" (
    "id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "publishing_department_id" TEXT,
    "publishing_department_name" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_post_reads" (
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_post_reads_pkey" PRIMARY KEY ("post_id","user_id")
);

-- CreateTable
CREATE TABLE "board_comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "content" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_attachments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "is_inline" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_categories_code_key" ON "board_categories"("code");

-- CreateIndex
CREATE INDEX "board_categories_sort_order_idx" ON "board_categories"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "boards_code_key" ON "boards"("code");

-- CreateIndex
CREATE INDEX "boards_category_id_sort_order_idx" ON "boards"("category_id", "sort_order");

-- CreateIndex
CREATE INDEX "boards_is_active_idx" ON "boards"("is_active");

-- CreateIndex
CREATE INDEX "board_posts_board_id_is_deleted_is_pinned_published_at_idx" ON "board_posts"("board_id", "is_deleted", "is_pinned", "published_at" DESC);

-- CreateIndex
CREATE INDEX "board_posts_author_id_idx" ON "board_posts"("author_id");

-- CreateIndex
CREATE INDEX "board_posts_publishing_department_id_idx" ON "board_posts"("publishing_department_id");

-- CreateIndex
CREATE INDEX "board_post_reads_user_id_idx" ON "board_post_reads"("user_id");

-- CreateIndex
CREATE INDEX "board_comments_post_id_created_at_idx" ON "board_comments"("post_id", "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "board_attachments_storage_key_key" ON "board_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "board_attachments_post_id_idx" ON "board_attachments"("post_id");

-- CreateIndex
CREATE INDEX "board_attachments_uploaded_by_idx" ON "board_attachments"("uploaded_by");

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "board_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_post_reads" ADD CONSTRAINT "board_post_reads_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_post_reads" ADD CONSTRAINT "board_post_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "board_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_attachments" ADD CONSTRAINT "board_attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "board_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_attachments" ADD CONSTRAINT "board_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

