// Browser polyfills for Node globals used by @ton/core (Buffer) when building
// TON payment comment payloads. This module's body runs on import, so it MUST be
// the very first import in main.tsx — that guarantees Buffer/global exist before
// @ton/core's module code evaluates (ESM evaluates imports in order).
import { Buffer } from 'buffer'

const g = globalThis as unknown as { Buffer?: unknown; global?: unknown }
if (!g.Buffer) g.Buffer = Buffer
if (!g.global) g.global = globalThis
