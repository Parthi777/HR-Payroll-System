/**
 * The Drive folder for an employee must belong to that employee's dealer.
 *
 * Folders are found by name, and the names collide readily across dealers —
 * every new dealer starts on the default `EMP` code prefix, so two of them with
 * a "Ravi Kumar - EMP001" produce the same folder name. A name search that is
 * not confined to one dealer's parent folder therefore resolves to whichever
 * folder the Drive API returns first, and one dealer's receipts upload into
 * another's. These tests pin the two rules that prevent it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// config/env.ts reads process.env once at import, so these are set before the
// dynamic import below. A service account is what makes Drive "configured".
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sa@example.com', private_key: 'k' });
process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID = 'dealer-one-folder';
process.env.GOOGLE_DRIVE_SHARE_WITH = 'hr@dealer-one.example';

const list = vi.fn();
const create = vi.fn();
const permissionsCreate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: class {},
      OAuth2: class {
        setCredentials() {}
      },
    },
    drive: () => ({ files: { list, create }, permissions: { create: permissionsCreate } }),
  },
}));

const { ensureEmployeeFolder } = await import('../src/services/storage/drive.service.js');

beforeEach(() => {
  list.mockReset().mockResolvedValue({ data: { files: [] } });
  create.mockReset().mockResolvedValue({ data: { id: 'created-folder' } });
  permissionsCreate.mockReset().mockResolvedValue({});
});

describe('employee Drive folders are confined to their own dealer', () => {
  it('searches only inside the dealer’s own parent folder', async () => {
    await ensureEmployeeFolder('EMP001', 'Ravi Kumar', {
      parentFolderId: 'dealer-two-folder',
      shareWith: null,
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0].q).toContain("'dealer-two-folder' in parents");
  });

  it('never runs an unscoped name search when the dealer has no folder', async () => {
    await ensureEmployeeFolder('EMP001', 'Ravi Kumar', { parentFolderId: null, shareWith: null });

    // The leak: a search with no parent clause spans the whole Drive and would
    // match another dealer's identically named folder. Creating is the safe
    // answer — a duplicate folder is recoverable, a shared one is not.
    expect(list).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].requestBody.parents).toBeUndefined();
  });

  it('ignores the platform folder from the environment', async () => {
    await ensureEmployeeFolder('EMP001', 'Ravi Kumar', { parentFolderId: null, shareWith: null });

    const query = JSON.stringify(list.mock.calls) + JSON.stringify(create.mock.calls);
    expect(query).not.toContain('dealer-one-folder');
  });

  it('creates inside the dealer’s parent when one is configured', async () => {
    await ensureEmployeeFolder('EMP001', 'Ravi Kumar', {
      parentFolderId: 'dealer-two-folder',
      shareWith: null,
    });

    expect(create.mock.calls[0][0].requestBody.parents).toEqual(['dealer-two-folder']);
  });

  it('reuses a folder that is already in the dealer’s own parent', async () => {
    list.mockResolvedValue({ data: { files: [{ id: 'existing-folder' }] } });

    const id = await ensureEmployeeFolder('EMP001', 'Ravi Kumar', {
      parentFolderId: 'dealer-two-folder',
      shareWith: null,
    });

    expect(id).toBe('existing-folder');
    expect(create).not.toHaveBeenCalled();
  });

  it('shares with the dealer’s own admin, not the platform address', async () => {
    await ensureEmployeeFolder('EMP001', 'Ravi Kumar', {
      parentFolderId: 'dealer-two-folder',
      shareWith: 'hr@dealer-two.example',
    });

    expect(permissionsCreate).toHaveBeenCalledTimes(1);
    expect(permissionsCreate.mock.calls[0][0].requestBody.emailAddress).toBe('hr@dealer-two.example');
  });

  it('shares with nobody when the dealer has no address of its own', async () => {
    await ensureEmployeeFolder('EMP001', 'Ravi Kumar', { parentFolderId: 'dealer-two-folder', shareWith: null });

    // Falling back to GOOGLE_DRIVE_SHARE_WITH here would give the first
    // dealer's HR admin write access to a second dealer's claim folders.
    expect(permissionsCreate).not.toHaveBeenCalled();
  });
});
