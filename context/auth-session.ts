import { createContext } from 'react';
import type { Session } from './AuthContext';

// Context identity must survive provider/route Fast Refresh and lazy route loading.
// Type-only import above creates no runtime dependency on the provider module.
export const AuthSessionContext = createContext<Session | null>(null);
