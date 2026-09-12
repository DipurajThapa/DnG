export interface ExternalProductionBindings {
  enterpriseOidcTenantBound:boolean;
  providerTenantsRegistered:boolean;
  productionSecretsBound:boolean;
  managedDatabaseBound:boolean;
  durableWorkerBound:boolean;
  deployedDomainTlsBound:boolean;
}
export interface PreProductionEvidence {
  regressionPass:boolean;
  schemaIntegrityPass:boolean;
  auditIntegrityPass:boolean;
  authorizationPass:boolean;
  multiRoleAcceptancePass:boolean;
  providerRuntimePass:boolean;
  failureRecoveryPass:boolean;
  backupRestorePass:boolean;
  signedReleasePass:boolean;
  observabilityPass:boolean;
  reconciliationPass:boolean;
  external:ExternalProductionBindings;
}
export class PreProductionAcceptanceGate {
  evaluate(e:PreProductionEvidence):{softwareReady:boolean;externalBindingsReady:boolean;productionReady:boolean;softwareBlockers:readonly string[];externalBlockers:readonly string[]}{
    const softwareChecks:readonly [boolean,string][]=[
      [e.regressionPass,'Cumulative regression is not green.'],[e.schemaIntegrityPass,'Schema/FK integrity is not verified.'],[e.auditIntegrityPass,'Audit integrity is not verified.'],
      [e.authorizationPass,'Authorization/security acceptance is incomplete.'],[e.multiRoleAcceptancePass,'Multi-role acceptance is incomplete.'],[e.providerRuntimePass,'Provider runtime acceptance is incomplete.'],
      [e.failureRecoveryPass,'Failure/recovery acceptance is incomplete.'],[e.backupRestorePass,'Backup/restore acceptance is incomplete.'],[e.signedReleasePass,'Signed release verification is incomplete.'],
      [e.observabilityPass,'Operational observability acceptance is incomplete.'],[e.reconciliationPass,'Missed-event reconciliation acceptance is incomplete.'],
    ];
    const externalChecks:readonly [boolean,string][]=[
      [e.external.enterpriseOidcTenantBound,'Enterprise OIDC tenant is not bound.'],[e.external.providerTenantsRegistered,'Production provider tenants/webhooks are not registered.'],
      [e.external.productionSecretsBound,'Production secrets are not bound.'],[e.external.managedDatabaseBound,'Managed production database is not bound.'],
      [e.external.durableWorkerBound,'Durable production worker/queue is not bound.'],[e.external.deployedDomainTlsBound,'Production domain/TLS is not bound.'],
    ];
    const softwareBlockers=softwareChecks.filter(([ok])=>!ok).map(([,m])=>m); const externalBlockers=externalChecks.filter(([ok])=>!ok).map(([,m])=>m);
    const softwareReady=softwareBlockers.length===0,externalBindingsReady=externalBlockers.length===0;
    return {softwareReady,externalBindingsReady,productionReady:softwareReady&&externalBindingsReady,softwareBlockers,externalBlockers};
  }
}
