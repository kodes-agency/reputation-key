import { z } from 'zod/v4'

// Run before schema imports: CSP blocks even Zod's eval availability probe.
z.config({ jitless: true })
