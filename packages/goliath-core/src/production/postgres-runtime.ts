import type { SyncSqlDatabase } from '../persistence/sync-database.js';
import { connectPostgresSyncDatabase, type PostgresSyncDatabase, type SyncPostgresClientLoader } from '../persistence/postgres-sync.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { ProjectControlService } from '../project/service.js';
import { SqlContextRepository } from '../context/repository.js';
import { EnterpriseContextService } from '../context/service.js';
import { ActingContextBoundary } from '../application/context-boundary.js';
import { SqlResourceRepository } from '../resource/repository.js';
import { ResourceCapacityService } from '../resource/service.js';
import { SqlFinanceRepository } from '../finance/repository.js';
import { FinanceService } from '../finance/service.js';
import { ContextualProjectApplication } from '../application/project-application.js';
import { RoleExperienceService } from '../experience/service.js';
import { SqlProviderRuntimeRepository } from '../runtime/provider-runtime.js';

export interface SqlRuntimeCore {
  db: SyncSqlDatabase;
  projectRepo: SqlProjectRepository;
  projectService: ProjectControlService;
  contextRepo: SqlContextRepository;
  contextService: EnterpriseContextService;
  boundary: ActingContextBoundary;
  resourceRepo: SqlResourceRepository;
  resourceService: ResourceCapacityService;
  financeRepo: SqlFinanceRepository;
  financeService: FinanceService;
  projectApp: ContextualProjectApplication;
  experienceService: RoleExperienceService;
  providerRuntimeRepo: SqlProviderRuntimeRepository;
}

/**
 * Builds the existing GOLIATH domain/application stack over any supported SQL database port.
 * No business rule is duplicated for PostgreSQL; only the SQL transport changes.
 */
export function createSqlRuntimeCore(
  db: SyncSqlDatabase,
  now: () => Date = () => new Date(),
): SqlRuntimeCore {
  const projectRepo = new SqlProjectRepository(db);
  const projectService = new ProjectControlService(projectRepo, now);
  const contextRepo = new SqlContextRepository(db);
  const contextService = new EnterpriseContextService(contextRepo, now);
  const boundary = new ActingContextBoundary(contextService);
  const resourceRepo = new SqlResourceRepository(db);
  const resourceService = new ResourceCapacityService(boundary, contextService, resourceRepo, projectRepo, now);
  const financeRepo = new SqlFinanceRepository(db);
  const financeService = new FinanceService(boundary, contextService, financeRepo, projectRepo, now);
  const projectApp = new ContextualProjectApplication(boundary, projectRepo, projectService);
  const experienceService = new RoleExperienceService(boundary, projectRepo, resourceService, financeService, now);
  const providerRuntimeRepo = new SqlProviderRuntimeRepository(db, now);
  return {
    db,
    projectRepo,
    projectService,
    contextRepo,
    contextService,
    boundary,
    resourceRepo,
    resourceService,
    financeRepo,
    financeService,
    projectApp,
    experienceService,
    providerRuntimeRepo,
  };
}

export interface PostgresRuntimeCore extends SqlRuntimeCore { db: PostgresSyncDatabase; }

export async function connectPostgresRuntimeCore(
  connectionString: string,
  options: { now?: () => Date; clientLoader?: SyncPostgresClientLoader } = {},
): Promise<PostgresRuntimeCore> {
  const db = await connectPostgresSyncDatabase(connectionString, options.clientLoader);
  const core = createSqlRuntimeCore(db, options.now);
  return { ...core, db };
}
