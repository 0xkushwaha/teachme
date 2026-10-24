import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  bookingId: string;
}

export class VerifyPaymentDto {
  @IsUUID()
  bookingId: string;

  @IsString()
  @Matches(/^order_[A-Za-z0-9]+$/)
  razorpay_order_id: string;

  @IsString()
  @Matches(/^pay_[A-Za-z0-9]+$/)
  razorpay_payment_id: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  razorpay_signature: string;
}

export class PaymentFailureDto {
  @IsUUID()
  bookingId: string;

  @IsString()
  @MaxLength(300)
  reason: string;
}
