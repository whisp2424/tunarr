import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/schema/db.ts';
import { DrizzleMigrator } from './DrizzleMigrator.ts';
import { DirectMigrationProvider } from './DirectMigrationProvider.ts';

describe('fork upgrade migrations', () => {
  it.each([false, true])(
    'upgrades with single_block already present: %s',
    async (alreadyApplied) => {
      const sqlite = new Database(':memory:');
      sqlite.exec(`
      CREATE TABLE migrations (name text PRIMARY KEY, timestamp text NOT NULL);
      CREATE TABLE custom_show (uuid text PRIMARY KEY${alreadyApplied ? ', single_block integer DEFAULT false NOT NULL' : ''});
      CREATE TABLE stream_selection_profiles (uuid text PRIMARY KEY, name text NOT NULL, rules text NOT NULL, created_at integer, updated_at integer);
      INSERT INTO stream_selection_profiles VALUES ('profile', 'Test', '[{"subtitleAction":{"type":"by_language","filterType":"not_forced"}},{"subtitleAction":{"type":"by_language","filterType":"forced","filterOrder":["default","forced"]}}]', NULL, NULL);
    `);
      const db = drizzle(sqlite);
      const migrations = new DirectMigrationProvider().getMigrationsSync();
      const insertMigration = sqlite.prepare(
        'INSERT INTO migrations VALUES (?, ?)',
      );
      for (const name of Object.keys(migrations)) {
        if (
          ![
            'migration1793564678',
            'migration1793744314',
            'migration1794118492',
          ].includes(name) ||
          (alreadyApplied && name === 'migration1793744314')
        ) {
          insertMigration.run(name, '2026-01-01T00:00:00.000Z');
        }
      }
      const kysely = new Kysely<DB>({
        dialect: new SqliteDialect({ database: sqlite }),
      });
      const migrator = new DrizzleMigrator(db, kysely);
      expect(migrator.getUnknownAppliedMigrations()).toEqual([]);
      const result = await migrator.migrateToLatest();
      expect(result.error).toBeUndefined();
      expect(
        result.results
          ?.filter((migration) => migration.status === 'Success')
          .map((migration) => migration.migrationName),
      ).toEqual(
        alreadyApplied
          ? ['migration1793564678', 'migration1794118492']
          : [
              'migration1793564678',
              'migration1793744314',
              'migration1794118492',
            ],
      );
      const columns = sqlite.pragma('table_info(custom_show)') as {
        name: string;
      }[];
      expect(columns.map((column) => column.name)).toContain('single_block');
      expect(columns.map((column) => column.name)).toContain(
        'stream_selection_profile_id',
      );
      const row = sqlite
        .prepare(
          "SELECT rules FROM stream_selection_profiles WHERE uuid = 'profile'",
        )
        .get() as { rules: string };
      expect(JSON.parse(row.rules)).toEqual([
        { subtitleAction: { type: 'by_language', filterType: 'any' } },
        { subtitleAction: { type: 'by_language', filterType: 'default' } },
      ]);
      await kysely.destroy();
    },
  );
});
