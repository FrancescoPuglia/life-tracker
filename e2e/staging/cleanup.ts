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
      const response = await fetchImplementation(
        firestoreDocumentUrl(configuration.projectId, resource.identity.uid, collection, id),
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${resource.identity.idToken}` },
          signal: AbortSignal.timeout(30_000),
        },
      ).catch(() => null);
      if (response && (response.ok || response.status === 404)) {
        deletedUserDocuments += 1;
      } else {
        identityDocumentsComplete = false;
      }
    }

    attemptedAuthAccounts += 1;
    if (!identityDocumentsComplete) continue;
    const authResponse = await fetchImplementation(
      `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(configuration.firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: resource.identity.idToken }),
        signal: AbortSignal.timeout(30_000),
      },
    ).catch(() => null);
    if (authResponse?.ok) deletedAuthAccounts += 1;
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
