import { PROJECT_COMMAND_KINDS } from './project-command-pipeline.js';

const text = value => String(value ?? '').trim();

function commandError(code, message, detail = null) {
  const error = new Error(message);
  error.code = code;
  if (detail != null) error.detail = detail;
  return error;
}

function targets(context = {}) {
  const values = Array.isArray(context.targets)
    ? context.targets
    : context.target ? [context.target] : [];
  return values.filter(value => value?.domain && value?.id);
}

function assertResult(result, ref, operation) {
  if (result === false || result?.ok === false) {
    throw commandError(result?.code || 'PL-CMD-OBJECT-001', `${operation} failed for ${ref.domain}:${ref.id}`, result);
  }
  return result;
}

export function createObjectCommandDefinitions({ adapters }) {
  if (!adapters?.get || !adapters?.isLocked) throw new TypeError('object command definitions require an ObjectAdapterRegistry');

  return Object.freeze({
    'object.focus': Object.freeze({
      id: 'object.focus',
      kind: PROJECT_COMMAND_KINDS.VIEW,
      validate(context) {
        const ref = context.target || targets(context)[0];
        return ref && adapters.get(ref) ? true : { ok: false, code: 'not-found' };
      },
      execute(context) {
        const ref = context.target || targets(context)[0];
        return assertResult(adapters.focus(ref), ref, 'focus');
      },
      renderDirty: null,
      autosave: false,
    }),

    'object.lock.toggle': Object.freeze({
      id: 'object.lock.toggle',
      kind: PROJECT_COMMAND_KINDS.DOCUMENT,
      prepare(context, payload = {}) {
        const refs = targets(context).filter(ref => adapters.get(ref));
        if (!refs.length) throw commandError('PL-CMD-OBJECT-NOT-FOUND', 'No lockable objects were selected.');
        const locked = typeof payload?.locked === 'boolean'
          ? payload.locked
          : !refs.every(ref => adapters.isLocked(ref));
        const changed = refs.filter(ref => adapters.isLocked(ref) !== locked);
        return changed.length
          ? { refs: changed, locked, affectedIds: changed.map(ref => text(ref.id)) }
          : { skip: true };
      },
      history(_context, _payload, prepared) {
        return {
          type: 'batch-lock',
          description: `${prepared.refs.length}개 객체 ${prepared.locked ? '잠금' : '잠금 해제'}`,
          affectedIds: prepared.affectedIds,
        };
      },
      execute(_context, _payload, prepared) {
        for (const ref of prepared.refs) assertResult(adapters.setLocked(ref, prepared.locked), ref, 'setLocked');
        return { changed: true, locked: prepared.locked, count: prepared.refs.length };
      },
      renderDirty: 'object-state',
    }),

    'object.visibility.set': Object.freeze({
      id: 'object.visibility.set',
      kind: PROJECT_COMMAND_KINDS.DOCUMENT,
      prepare(context, payload = {}) {
        const refs = targets(context).filter(ref => adapters.get(ref));
        if (!refs.length) throw commandError('PL-CMD-OBJECT-NOT-FOUND', 'No objects were selected.');
        const visible = payload?.visible !== false;
        const changed = refs.filter(ref => adapters.isVisible(ref) !== visible);
        return changed.length
          ? { refs: changed, visible, affectedIds: changed.map(ref => text(ref.id)) }
          : { skip: true };
      },
      history(_context, _payload, prepared) {
        return {
          type: 'batch-visibility',
          description: `${prepared.refs.length}개 객체 ${prepared.visible ? '표시' : '숨김'}`,
          affectedIds: prepared.affectedIds,
        };
      },
      execute(_context, _payload, prepared) {
        for (const ref of prepared.refs) assertResult(adapters.setVisibility(ref, prepared.visible), ref, 'setVisibility');
        return { changed: true, visible: prepared.visible, count: prepared.refs.length };
      },
      renderDirty: 'object-visibility',
    }),

    'object.delete': Object.freeze({
      id: 'object.delete',
      kind: PROJECT_COMMAND_KINDS.DOCUMENT,
      prepare(context) {
        const refs = targets(context).filter(ref => adapters.get(ref));
        if (!refs.length) throw commandError('PL-CMD-OBJECT-NOT-FOUND', 'No deletable objects were selected.');
        const blocked = refs.find(ref => adapters.isLocked(ref) || !adapters.canRemove(ref));
        if (blocked) throw commandError('PL-CMD-OBJECT-DELETE-BLOCKED', `Object cannot be deleted: ${blocked.domain}:${blocked.id}`, blocked);
        return { refs, affectedIds: refs.map(ref => text(ref.id)) };
      },
      history(_context, _payload, prepared) {
        return {
          type: 'batch-delete',
          description: `${prepared.refs.length}개 객체 삭제`,
          affectedIds: prepared.affectedIds,
        };
      },
      execute(_context, _payload, prepared) {
        for (const ref of prepared.refs) assertResult(adapters.remove(ref), ref, 'remove');
        return { changed: true, count: prepared.refs.length };
      },
      renderDirty: 'object-structure',
    }),
  });
}
