-- Second database for integration tests (wiped by the test suite).
-- Prisma migrate dev also needs to create a shadow database, so the app user gets CREATE rights locally.
CREATE DATABASE IF NOT EXISTS lowbid_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON lowbid_test.* TO 'lowbid'@'%';
GRANT CREATE, ALTER, DROP, REFERENCES, INDEX ON *.* TO 'lowbid'@'%';
FLUSH PRIVILEGES;
