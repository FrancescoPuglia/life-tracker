import { describe, expect, it } from 'vitest';
import { createLifeTrackerDomain } from '../../src/domain/factory';
import { InMemoryRepository } from '../../src/domain/in-memory-repository';
import { ReadOnlyMcpDomainAdapter } from '../../src/mcp/read-only-adapter';

const FILTER = {
  query: null,
  from: null,
  to: null,
  status: null,
  domainId: null,
  projectId: null,
  goalId: null,
  taskId: null,
};

describe('MCP-ready read-only domain adapter', () => {
  it('is off by default and exposes only the existing read registry when enabled', async () => {
    const repository = new InMemoryRepository();
    repository.seed('owner', 'goals', [{ id: 'goal-1', title: 'Owned goal' }]);
    const domain = createLifeTrackerDomain(repository);
    const disabled = new ReadOnlyMcpDomainAdapter(domain.registry, domain.executor, false);
    expect(() => disabled.definitions()).toThrowError('MCP read access is disabled.');

    const enabled = new ReadOnlyMcpDomainAdapter(domain.registry, domain.executor, true);
    const names = enabled.definitions().map((tool) => tool.name);
    expect(names).toContain('get_goals');
    expect(names).not.toContain('preview_changes');
    expect(names).not.toContain('preview_timeblock_change');
    expect(names).not.toContain('apply_plan');
    expect(names).not.toContain('rollback_plan');

    await expect(enabled.execute(
      { uid: 'owner', requestId: 'mcp-read' },
      'get_goals',
      { filter: FILTER, cursor: null, limit: 10 },
    )).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'goal-1' })] });
  });

  it('fails closed if an MCP caller names a proposal or privileged operation', async () => {
    const domain = createLifeTrackerDomain(new InMemoryRepository());
    const adapter = new ReadOnlyMcpDomainAdapter(domain.registry, domain.executor, true);
    const context = { uid: 'owner', requestId: 'mcp-write-attempt' };

    await expect(adapter.execute(context, 'preview_changes', {}))
      .rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
    await expect(adapter.execute(context, 'apply_plan', {}))
      .rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
    await expect(adapter.execute(context, 'rollback_plan', {}))
      .rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
  });
});
