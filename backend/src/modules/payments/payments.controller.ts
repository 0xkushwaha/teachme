import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Idempotent, Public, Roles, SkipCsrf } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { AppError, ErrorCode } from '../../common/errors';
import { PaymentsService } from './payments.service';
import { CreateOrderDto, PaymentFailureDto, VerifyPaymentDto } from './dto/payments.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Roles('STUDENT')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  @Post('orders')
  createOrder(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.payments.createOrder(user, dto.bookingId);
  }

  @Roles('STUDENT')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('razorpay/verify')
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyPaymentDto) {
    return this.payments.verifyCheckout(user, dto);
  }

  @Roles('STUDENT')
  @HttpCode(200)
  @Post('razorpay/client-failure')
  clientFailure(@CurrentUser() user: AuthUser, @Body() dto: PaymentFailureDto) {
    return this.payments.reportClientFailure(user, dto.bookingId, dto.reason);
  }

  /** Server-to-server; authenticated by HMAC signature over the raw body. */
  @Public()
  @SkipCsrf()
  @SkipThrottle()
  @HttpCode(200)
  @Post('razorpay/webhook')
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    if (!req.rawBody) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Missing body');
    return this.payments.handleWebhook(req.rawBody, signature, eventId);
  }
}
