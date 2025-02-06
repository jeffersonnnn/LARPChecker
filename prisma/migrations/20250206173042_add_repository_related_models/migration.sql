/*
  Warnings:

  - A unique constraint covering the columns `[type]` on the table `RateLimit` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('PRODUCTION', 'DEVELOPMENT');

-- AlterEnum
ALTER TYPE "RateLimitType" ADD VALUE 'TWITTER_API';

-- AlterTable
ALTER TABLE "RateLimit" ADD COLUMN     "limit" INTEGER NOT NULL DEFAULT 5000;

-- AlterTable
ALTER TABLE "RepositoryMetadata" ADD COLUMN     "contributors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "issues" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Commit" (
    "id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "additions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "files" INTEGER NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL,
    "source" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Commit_sha_key" ON "Commit"("sha");

-- CreateIndex
CREATE INDEX "Commit_repositoryUrl_idx" ON "Commit"("repositoryUrl");

-- CreateIndex
CREATE INDEX "Dependency_repositoryUrl_idx" ON "Dependency"("repositoryUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Dependency_repositoryUrl_name_version_key" ON "Dependency"("repositoryUrl", "name", "version");

-- CreateIndex
CREATE INDEX "Language_repositoryUrl_idx" ON "Language"("repositoryUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Language_repositoryUrl_name_key" ON "Language"("repositoryUrl", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_type_key" ON "RateLimit"("type");

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_repositoryUrl_fkey" FOREIGN KEY ("repositoryUrl") REFERENCES "RepositoryMetadata"("url") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_repositoryUrl_fkey" FOREIGN KEY ("repositoryUrl") REFERENCES "RepositoryMetadata"("url") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Language" ADD CONSTRAINT "Language_repositoryUrl_fkey" FOREIGN KEY ("repositoryUrl") REFERENCES "RepositoryMetadata"("url") ON DELETE RESTRICT ON UPDATE CASCADE;
