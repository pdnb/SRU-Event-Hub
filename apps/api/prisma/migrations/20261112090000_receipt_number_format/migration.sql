-- FIN-2 (answered 2026-11-07): receipt numbers are "<fiscal year>/<running no>" e.g. 2569/0001 — no book number.
-- Fails loudly if existing rows would collide once the book number is dropped (resolve those by hand first).
DROP INDEX "receipt_records_fiscal_year_book_no_receipt_no_key";
ALTER TABLE "receipt_records" DROP COLUMN "book_no";
CREATE UNIQUE INDEX "receipt_records_fiscal_year_receipt_no_key" ON "receipt_records"("fiscal_year", "receipt_no");
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_receipt_no_chk" CHECK ("receipt_no" ~ '^[0-9]{4,10}$') NOT VALID;
