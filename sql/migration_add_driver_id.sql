-- Migration: Add driver_id column to profiles table
-- This migration adds support for driver authentication by user ID

-- Add driver_id column to profiles table
ALTER TABLE yango.profiles ADD COLUMN IF NOT EXISTS driver_id VARCHAR(20) UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_driver_id ON yango.profiles(driver_id);
