export class GoliathError extends Error {
  constructor(
    public readonly code:
      | 'ACCESS_DENIED'
      | 'NOT_FOUND'
      | 'STALE_REVISION'
      | 'MAPPING_REQUIRED'
      | 'FIELD_AUTHORITY_DENIED'
      | 'ACTION_NOT_ALLOWED'
      | 'APPROVAL_REQUIRED'
      | 'DUPLICATE_EVENT'
      | 'INVALID_INPUT'
      | 'INTEGRATION_DISABLED'
      | 'RECOVERY_BLOCKED'
      | 'AUTOMATION_BLOCKED',
    message: string,
  ) {
    super(message);
    this.name = 'GoliathError';
  }
}
