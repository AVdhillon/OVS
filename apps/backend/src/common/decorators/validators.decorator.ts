// src/common/decorators/validators.decorator.ts

import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * @IsEmailOrPhone() — class-validator field decorator.
 * Accepts either a valid email address or a simple international phone
 * number (digits, optional leading '+', 10–15 digits).
 */
export function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isEmailOrPhone',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (!value) return true; // handled by @IsOptional

          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

          // simple international phone (digits, +, 10–15 length)
          const phoneRegex = /^\+?[1-9]\d{9,14}$/;

          return emailRegex.test(value) || phoneRegex.test(value);
        },
        defaultMessage() {
          return 'caller_identifier must be a valid email or phone number';
        },
      },
    });
  };
}
