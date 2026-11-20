import React from 'react';
import { Redirect } from 'expo-router';

/** People search lives only in central Keşfet. */
export default function People() {
  return <Redirect href="/search?tab=people" />;
}
