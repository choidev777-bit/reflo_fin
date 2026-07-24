import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import { uuidv7 } from "../../domain/ids";

export type IdentityProfile = {
  issuer: string;
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export type SessionRecord = {
  sessionId: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  tokenHash: string;
  csrfSecretHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export async function createLoginAttempt(input: {
  attemptId: string;
  stateHash: string;
  verifierHash: string;
  nonceHash: string;
  returnTo: string;
  intent: string | null;
  expiresAt: Date;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO oauth_login_attempt (
        attempt_id, state_hash, verifier_hash, nonce_hash, return_to, intent, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.attemptId,
        input.stateHash,
        input.verifierHash,
        input.nonceHash,
        input.returnTo,
        input.intent,
        input.expiresAt,
      ],
    );
  });
}

export async function consumeLoginAttempt(
  attemptId: string,
  hashes: { stateHash: string; verifierHash: string; nonceHash: string },
): Promise<{ returnTo: string; intent: string | null }> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      return_to: string;
      intent: string | null;
      state_hash: string;
      verifier_hash: string;
      nonce_hash: string;
    }>(
      `SELECT return_to, intent, state_hash, verifier_hash, nonce_hash
       FROM oauth_login_attempt
       WHERE attempt_id = $1
         AND consumed_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [attemptId],
    );
    const attempt = result.rows[0];
    if (
      !attempt ||
      attempt.state_hash.trim() !== hashes.stateHash ||
      attempt.verifier_hash.trim() !== hashes.verifierHash ||
      attempt.nonce_hash.trim() !== hashes.nonceHash
    ) {
      throw new Error("OAUTH_ATTEMPT_INVALID");
    }

    await client.query(
      "UPDATE oauth_login_attempt SET consumed_at = now() WHERE attempt_id = $1",
      [attemptId],
    );
    return { returnTo: attempt.return_to, intent: attempt.intent };
  });
}

async function findOrCreateUser(
  client: TransactionClient,
  profile: IdentityProfile,
): Promise<string> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${profile.issuer}\u001f${profile.subject}`],
  );

  const existing = await client.query<{ user_id: string }>(
    `SELECT user_id FROM auth_identity WHERE issuer = $1 AND subject = $2`,
    [profile.issuer, profile.subject],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE user_account
       SET display_name = $2, email = $3, avatar_url = $4, updated_at = now()
       WHERE user_id = $1`,
      [
        existing.rows[0].user_id,
        profile.displayName,
        profile.email,
        profile.avatarUrl,
      ],
    );
    await client.query(
      `UPDATE auth_identity
       SET email_at_login = $3, claims_updated_at = now()
       WHERE issuer = $1 AND subject = $2`,
      [profile.issuer, profile.subject, profile.email],
    );
    return existing.rows[0].user_id;
  }

  const userId = uuidv7();
  await client.query(
    `INSERT INTO user_account (
      user_id, display_name, email, avatar_url
    ) VALUES ($1, $2, $3, $4)`,
    [userId, profile.displayName, profile.email, profile.avatarUrl],
  );
  await client.query(
    `INSERT INTO auth_identity (
      auth_identity_id, user_id, issuer, subject, email_at_login
    ) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), userId, profile.issuer, profile.subject, profile.email],
  );
  return userId;
}

export async function upsertIdentity(profile: IdentityProfile): Promise<string> {
  return withTransaction((client) => findOrCreateUser(client, profile));
}

export async function createSessionRecord(input: {
  profile: IdentityProfile;
  tokenHash: string;
  csrfSecretHash: string;
  expiresAt: Date;
  rotatedFromSessionId?: string;
}): Promise<{ sessionId: string; userId: string }> {
  return withTransaction(async (client) => {
    const userId = await findOrCreateUser(client, input.profile);
    const sessionId = uuidv7();
    await client.query(
      `INSERT INTO user_session (
        session_id, user_id, token_hash, csrf_secret_hash, expires_at,
        rotated_from_session_id
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        userId,
        input.tokenHash,
        input.csrfSecretHash,
        input.expiresAt,
        input.rotatedFromSessionId ?? null,
      ],
    );
    return { sessionId, userId };
  });
}

export async function findActiveSession(tokenHash: string): Promise<SessionRecord | null> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      session_id: string;
      user_id: string;
      display_name: string;
      email: string;
      avatar_url: string | null;
      token_hash: string;
      csrf_secret_hash: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
    }>(
      `SELECT
        s.session_id, s.user_id, u.display_name, u.email, u.avatar_url,
        s.token_hash, s.csrf_secret_hash, s.created_at, s.last_seen_at, s.expires_at
       FROM user_session s
       JOIN user_account u ON u.user_id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.account_status = 'active'`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;

    const absoluteExpiry = new Date(row.created_at.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (absoluteExpiry <= new Date()) {
      await client.query(
        "UPDATE user_session SET revoked_at = now() WHERE session_id = $1",
        [row.session_id],
      );
      return null;
    }

    const nextExpiry = new Date(
      Math.min(Date.now() + 7 * 24 * 60 * 60 * 1000, absoluteExpiry.getTime()),
    );
    await client.query(
      `UPDATE user_session
       SET last_seen_at = now(), expires_at = $2
       WHERE session_id = $1`,
      [row.session_id, nextExpiry],
    );

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url,
      tokenHash: row.token_hash.trim(),
      csrfSecretHash: row.csrf_secret_hash.trim(),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: nextExpiry,
    };
  });
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE user_session
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_hash = $1`,
      [tokenHash],
    );
  });
}
