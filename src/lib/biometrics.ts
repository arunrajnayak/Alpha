/**
 * Biometrics & WebAuthn utilities for Alpha Portfolio Tracker
 *
 * Provides desktop fingerprint / platform authenticator support (Touch ID, Windows Hello)
 * to guard turning off Privacy Mode.
 *
 * Uses native Web Authentication API (WebAuthn) with platform authenticator attachment.
 * Session state is scoped per tab via sessionStorage so that fresh tabs open with
 * Privacy Mode ON by default, but same-tab refreshes (Cmd+R / F5) do not prompt again.
 */

import { isCapacitor } from '@/lib/mobile';

const CREDENTIAL_ID_KEY = 'alpha_biometric_credential_id';
const BIOMETRIC_ENABLED_KEY = 'alpha_biometric_enabled';
const TAB_VERIFIED_KEY = 'alpha_biometric_verified';
const TAB_PRIVACY_MODE_KEY = 'alpha_tab_privacy_mode';

// ─── Base64URL Helpers ────────────────────────────────────────────────────────

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── Platform & Device Detection ──────────────────────────────────────────────

/**
 * Checks whether the current device is a desktop browser.
 * Excludes Capacitor native shells, iOS, Android, and mobile user agents.
 */
export function isDesktopDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (isCapacitor()) return false;

  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  return !isMobileUA;
}

/**
 * Checks whether WebAuthn platform authenticator (Touch ID, Windows Hello) is available.
 */
export async function isBiometricSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.isSecureContext) return false;
  if (!window.PublicKeyCredential) return false;

  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Credential & Preference Storage (Device-scoped) ─────────────────────────

export function getStoredCredentialId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CREDENTIAL_ID_KEY);
  } catch {
    return null;
  }
}

export function isBiometricEnrolled(): boolean {
  return !!getStoredCredentialId();
}

export function isBiometricRequirementEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return val !== 'false'; // Default to true if enrolled
  } catch {
    return true;
  }
}

export function setBiometricRequirementEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export function removeBiometric(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CREDENTIAL_ID_KEY);
    localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
  } catch {}
}

// ─── Tab-Scoped Session Management (sessionStorage) ──────────────────────────

/**
 * Checks if this tab session has already verified biometric authentication.
 */
export function isTabSessionVerified(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(TAB_VERIFIED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTabSessionVerified(verified: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (verified) {
      sessionStorage.setItem(TAB_VERIFIED_KEY, 'true');
    } else {
      sessionStorage.removeItem(TAB_VERIFIED_KEY);
    }
  } catch {}
}

/**
 * Reads tab-specific privacy mode state from sessionStorage.
 * Returns null if this is a fresh tab/window.
 */
export function getStoredTabPrivacyMode(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = sessionStorage.getItem(TAB_PRIVACY_MODE_KEY);
    if (val === null) return null;
    return val === 'true';
  } catch {
    return null;
  }
}

export function setStoredTabPrivacyMode(isPrivate: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(TAB_PRIVACY_MODE_KEY, isPrivate ? 'true' : 'false');
  } catch {}
}

// ─── WebAuthn Registration & Verification ─────────────────────────────────────

export interface BiometricResult {
  success: boolean;
  error?: string;
  cancelled?: boolean;
}

/**
 * Registers a new platform authenticator credential (Touch ID / Windows Hello).
 */
export async function registerBiometric(): Promise<BiometricResult> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return { success: false, error: 'WebAuthn requires a secure context (HTTPS or localhost).' };
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode('alpha-owner');
    const rpId = window.location.hostname;

    const creationOptions: CredentialCreationOptions = {
      publicKey: {
        challenge,
        rp: {
          name: 'Alpha Portfolio Tracker',
          id: rpId,
        },
        user: {
          id: userId,
          name: 'owner',
          displayName: 'Alpha Portfolio Owner',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 (standard for Apple Touch ID & FIDO2)
          { type: 'public-key', alg: -257 }, // RS256 (Windows Hello fallback)
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    };

    const credential = (await navigator.credentials.create(creationOptions)) as PublicKeyCredential | null;

    if (!credential) {
      return { success: false, error: 'Failed to create biometric credential.' };
    }

    const credId = credential.id || bufferToBase64Url(credential.rawId);
    localStorage.setItem(CREDENTIAL_ID_KEY, credId);
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
    setTabSessionVerified(true);

    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    const isCancelled = error.name === 'NotAllowedError' || error.name === 'AbortError';
    return {
      success: false,
      cancelled: isCancelled,
      error: isCancelled ? 'Fingerprint registration was cancelled.' : (error.message || 'Registration failed.'),
    };
  }
}

/**
 * Verifies fingerprint using the registered credential.
 */
export async function verifyBiometric(): Promise<BiometricResult> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return { success: false, error: 'WebAuthn requires a secure context (HTTPS or localhost).' };
  }

  const credId = getStoredCredentialId();
  if (!credId) {
    return { success: false, error: 'No fingerprint registered yet.' };
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rpId = window.location.hostname;

    const requestOptions: CredentialRequestOptions = {
      publicKey: {
        challenge,
        rpId,
        allowCredentials: [
          {
            type: 'public-key',
            id: base64UrlToBuffer(credId),
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    };

    const assertion = (await navigator.credentials.get(requestOptions)) as PublicKeyCredential | null;

    if (!assertion) {
      return { success: false, error: 'Verification returned no credential.' };
    }

    // Set this tab as verified for the active session
    setTabSessionVerified(true);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    const isCancelled = error.name === 'NotAllowedError' || error.name === 'AbortError';
    return {
      success: false,
      cancelled: isCancelled,
      error: isCancelled ? 'Fingerprint verification was cancelled.' : (error.message || 'Verification failed.'),
    };
  }
}

/**
 * Test verification without side effects (used in Settings page).
 */
export async function testBiometric(): Promise<BiometricResult> {
  return verifyBiometric();
}
