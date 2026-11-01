import { Module } from '@nestjs/common';
import { AdminInvitationsController, AdminTeacherReviewController, InvitationAcceptanceController, TeacherOnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [AdminInvitationsController, InvitationAcceptanceController, TeacherOnboardingController, AdminTeacherReviewController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
