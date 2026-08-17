export interface AuthErrorLike {
  readonly code?: unknown;
}

/**
 * Convert provider failures to allowlisted user messages without logging or
 * copying provider error objects, messages, token responses, or custom data.
 */
export function normalizeAuthError(error: AuthErrorLike): Error {
  switch (error.code) {
    case 'auth/user-not-found':
      return new Error('No user found with this email address');
    case 'auth/wrong-password':
      return new Error('Incorrect password');
    case 'auth/email-already-in-use':
      return new Error('An account already exists with this email address');
    case 'auth/weak-password':
      return new Error('Password should be at least 6 characters');
    case 'auth/invalid-email':
      return new Error('Invalid email address');
    case 'auth/too-many-requests':
      return new Error('Too many failed attempts. Try again later');
    case 'auth/popup-closed-by-user':
      return new Error('Sign-in popup was closed');
    case 'auth/cancelled-popup-request':
      return new Error('Sign-in was cancelled');
    case 'auth/network-request-failed':
      return new Error('Network error. Check your internet connection');
    default:
      return new Error('Authentication failed');
  }
}
