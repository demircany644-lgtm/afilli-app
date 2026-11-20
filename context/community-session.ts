import { createContext } from 'react';
import type { CommunityPerson } from '@workspace/api-client-react';

export type Session = {
  ready: boolean; userId: string | null; person: CommunityPerson | null;
  error: string | null; signOut: (redirectTo?: string) => Promise<void>; refreshProfile: () => Promise<void>;
};
// Keep context identity independent of provider/hook hot refresh and lazy screens.
// A missing provider remains a programming error; never invent an authenticated fallback.
export const CommunityContext = createContext<Session | null>(null);
