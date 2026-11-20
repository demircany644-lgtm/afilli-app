import { createContext } from 'react';
import type { Conversation } from '@workspace/api-client-react';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';
export type DirectSession = {
  owner: string | null; conversations: Conversation[]; loading: boolean; error: unknown;
  refresh: () => Promise<void>; connection: Connection; revision: number;
  mediaCleanupError: string | null;
};
export const DirectSessionContext = createContext<DirectSession | null>(null);
export const GifPrivacyContext = createContext<{
  allowed: boolean; setAllowed: (v: boolean) => void; customerId: string | null;
} | null>(null);
