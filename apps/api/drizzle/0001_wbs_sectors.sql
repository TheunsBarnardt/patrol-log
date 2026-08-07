-- Multi-tenant sector codes WBS1 / WBS2 / WBS3 (additive — does NOT wipe data).
-- Prerequisite (once): ALTER TABLE sectors ADD COLUMN code text;
-- Safe to re-run UPDATE/INSERT parts.

UPDATE sectors
SET code = 'WBS1', name = 'WBS1'
WHERE code IS NULL
   OR name LIKE '%Sector 1%'
   OR name = 'Wierdabrug Sector 1'
   OR name = 'Sector 1';

INSERT INTO sectors (id, cpf_id, name, code)
SELECT lower(hex(randomblob(16))), s.cpf_id, 'WBS2', 'WBS2'
FROM sectors s
WHERE s.code = 'WBS1'
  AND NOT EXISTS (
    SELECT 1 FROM sectors x WHERE x.cpf_id = s.cpf_id AND x.code = 'WBS2'
  )
LIMIT 1;

INSERT INTO sectors (id, cpf_id, name, code)
SELECT lower(hex(randomblob(16))), s.cpf_id, 'WBS3', 'WBS3'
FROM sectors s
WHERE s.code = 'WBS1'
  AND NOT EXISTS (
    SELECT 1 FROM sectors x WHERE x.cpf_id = s.cpf_id AND x.code = 'WBS3'
  )
LIMIT 1;
