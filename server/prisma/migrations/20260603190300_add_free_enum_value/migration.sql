-- Add FREE to the PlanTier enum (must be committed before it can be used)
ALTER TYPE "PlanTier" ADD VALUE IF NOT EXISTS 'FREE';
