export type PaginationParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export function parsePagination(
  pageRaw?: string,
  pageSizeRaw?: string,
  defaultPageSize = 20,
  maxPageSize = 100
): PaginationParams {
  const page = Number(pageRaw ?? 1);
  const pageSize = Number(pageSizeRaw ?? defaultPageSize);
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.min(Math.floor(pageSize), maxPageSize)
      : defaultPageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    skip: (safePage - 1) * safePageSize,
    take: safePageSize
  };
}
