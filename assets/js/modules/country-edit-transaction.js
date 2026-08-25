export async function runCountryEditTransaction({
  client,
  operation,
  payload,
  snapshot,
  applyResult,
  commitHistory,
  restore,
  queueAutosave,
  onSuccess = () => {},
  onError = () => {},
}) {
  let requestId = 0;
  let workerCommitted = false;
  try {
    const response = await client.execute(operation, payload);
    requestId = response.requestId;
    await applyResult(response.result);
    client.commit(requestId);
    workerCommitted = true;
    commitHistory(snapshot);
    queueAutosave();
    onSuccess(response.result);
    return { ok: true, result: response.result };
  } catch (error) {
    if (requestId && !workerCommitted) client.discard(requestId);
    restore(snapshot, { rebaseWorker: workerCommitted });
    if (!error?.cancelled) onError(error);
    return { ok: false, cancelled: !!error?.cancelled, error };
  }
}
