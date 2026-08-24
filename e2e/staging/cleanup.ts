import {
  discardResponseBody,
  retryableStagingTransportKind,
} from './read-only-transport';

export interface CleanupIdentity {
  readonly uid: string;
  readonly idToken: string;
}

export type CleanupDocumentReference = readonly [collection: string, id: string];

export interface CleanupResource {
  readonly identity: CleanupIdentity | undefined;
  readonly documents: readonly CleanupDocumentReference[];
}

export interface CleanupReport {
  readonly attemptedUserDocuments: number;
  readonly deletedUserDocuments: number;
  readonly attemptedAuthAccounts: number;
  readonly deletedAuthAccounts: number;
  readonly userAndAuthCleanupComplete: boolean;
  readonly serverArtifactPolicy: 'durable_audit_and_ttl_managed_ephemeral_records';
}

export interface CleanupConfiguration {
  readonly projectId: string;
  readonly firebaseApiKey: string;
}

export async function cleanupStagingResources(
  configuration: CleanupConfiguration,
  resources: readonly CleanupResource[],
  fetchImplementation: typeof fetch = fetch,
): Promise<CleanupReport> {
  let attemptedUserDocuments = 0;
  let deletedUserDocuments = 0;
  let attemptedAuthAccounts = 0;
  let deletedAuthAccounts = 0;

  for (const resource of resources) {
    if (!resource.identity) continue;
    const uniqueDocuments = [...new Map(resource.documents.map((reference) => [
      documentKey(reference[0], reference[1]),
      reference,
    ])).values()].reverse();
    let identityDocumentsComplete = true;
    for (const [collection, id] of uniqueDocuments) {
      attemptedUserDocuments += 1;
      const removed = await deleteDocumentWithBoundedTransportRetry(
        configuration.projectId,
        resource.identity.uid,
        collection,
        id,
        firestoreDocumentUrl(configuration.projectId, resource.identity.uid, collection, id),
        resource.identity.idToken,
        fetchImplementation,
      );
      if (removed) {
        deletedUserDocuments += 1;
      } else {
        identityDocumentsComplete = false;
      }
    }

    if (!identityDocumentsComplete) continue;
    attemptedAuthAccounts += 1;
    const authResponse = await fetchImplementation(
      `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(configuration.firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: resource.identity.idToken }),
        signal: AbortSignal.timeout(30_000),
      },
    ).catch(() => null);
    if (authResponse) {
      const deleted = authResponse.ok;
      await discardResponseBody(authResponse);
      if (deleted) deletedAuthAccounts += 1;
    }
  }

  return {
    attemptedUserDocuments,
    deletedUserDocuments,
    attemptedAuthAccounts,
    deletedAuthAccounts,
    userAndAuthCleanupComplete: attemptedUserDocuments === deletedUserDocuments
      && attemptedAuthAccounts === deletedAuthAccounts,
    serverArtifactPolicy: 'durable_audit_and_ttl_managed_ephemeral_records',
  };
}

async function deleteDocumentWithBoundedTransportRetry(
  projectId: string,
  uid: string,
  collection: string,
  id: string,
  url: string,
  idToken: string,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      const removed = response.ok || response.status === 404;
      const requiresAbsenceProof = response.status === 403;
      await discardResponseBody(response);
      return removed || (requiresAbsenceProof && await exactOwnedDocumentIsAbsent(
        projectId,
        uid,
        collection,
        id,
        idToken,
        fetchImplementation,
      ));
    } catch (error) {
      if (retryableStagingTransportKind(error) !== null && attempt < 2) continue;
      return false;
    }
  }
  return false;
}

async function exactOwnedDocumentIsAbsent(
  projectId: string,
  uid: string,
  collection: string,
  id: string,
  idToken: string,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  const referenceValue = `projects/${projectId}/databases/(default)/documents/users/`
    + `${uid}/${collection}/${id}`;
  const collectionPrefix = `projects/${projectId}/databases/(default)/documents/users/`
    + `${uid}/${collection}/`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImplementation(`${firestoreUserUrl(projectId, uid)}:runQuery`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collection }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'userId' },
                op: 'EQUAL',
                value: { stringValue: uid },
              },
            },
            limit: 101,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        await discardResponseBody(response);
        return false;
      }
      const results = await response.json().catch(() => null) as unknown;
      if (!Array.isArray(results)) return false;
      let documents = 0;
      for (const entry of results) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const document = (entry as Record<string, unknown>).document;
        if (document === undefined) continue;
        if (!document || typeof document !== 'object' || Array.isArray(document)) return false;
        const name = (document as Record<string, unknown>).name;
        if (typeof name !== 'string' || !name.startsWith(collectionPrefix)) return false;
        documents += 1;
        if (documents > 100 || name === referenceValue) return false;
      }
      return true;
    } catch (error) {
      if (retryableStagingTransportKind(error) !== null && attempt < 2) continue;
      return false;
    }
  }
  return false;
}

function firestoreDocumentUrl(
  projectId: string,
  uid: string,
  collection: string,
  id: string,
): string {
  return `${firestoreUserUrl(projectId, uid)}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
}

function firestoreUserUrl(projectId: string, uid: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
}

function documentKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}
