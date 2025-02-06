-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RateLimitType" AS ENUM ('GITHUB_API', 'GITHUB_SEARCH', 'OPENAI_API');

-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN     "status" "AnalysisStatus" NOT NULL DEFAULT 'COMPLETED';

-- CreateTable
CREATE TABLE "AnalysisQueue" (
    "id" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "AnalysisQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryMetadata" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "lastCommit" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "type" "RateLimitType" NOT NULL,
    "remaining" INTEGER NOT NULL,
    "reset" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryMetadata_url_key" ON "RepositoryMetadata"("url");

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_repositoryUrl_fkey" FOREIGN KEY ("repositoryUrl") REFERENCES "RepositoryMetadata"("url") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisQueue" ADD CONSTRAINT "AnalysisQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisQueue" ADD CONSTRAINT "AnalysisQueue_repositoryUrl_fkey" FOREIGN KEY ("repositoryUrl") REFERENCES "RepositoryMetadata"("url") ON DELETE RESTRICT ON UPDATE CASCADE;
