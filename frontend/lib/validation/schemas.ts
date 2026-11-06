import {z} from 'zod';
export const loginSchema=z.object({email:z.string().email('Enter a valid email address'),password:z.string().min(1,'Enter your password')});
export const registerSchema=loginSchema.extend({name:z.string().trim().min(2,'Enter your full name'),password:z.string().min(8,'Use at least 8 characters').regex(/\d/,'Include at least one number')});
export const checkoutSchema=z.object({planId:z.string().min(1,'Select a plan'),acceptTerms:z.literal(true,{errorMap:()=>({message:'Accept the terms to continue'})})});
export const forgotPasswordSchema=z.object({email:z.string().email('Enter a valid email address')});
export const resetPasswordSchema=z.object({token:z.string().min(1),password:z.string().min(8,'Use at least 8 characters').regex(/\d/,'Include at least one number')});
export const changePasswordSchema=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(8,'Use at least 8 characters').regex(/\d/,'Include at least one number')});
