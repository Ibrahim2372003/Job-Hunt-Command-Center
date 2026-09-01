-- DropForeignKey
ALTER TABLE "TailoredResume" DROP CONSTRAINT "TailoredResume_applicationId_fkey";

-- AddForeignKey
ALTER TABLE "TailoredResume" ADD CONSTRAINT "TailoredResume_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
