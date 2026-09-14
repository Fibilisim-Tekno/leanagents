export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

const MAX_PAGE_SIZE = 100;

export function normalisePageRequest(input: Partial<PageRequest>): PageRequest {
  const page = Number.isInteger(input.page) && input.page! > 0 ? input.page! : 1;
  const requestedSize =
    Number.isInteger(input.pageSize) && input.pageSize! > 0 ? input.pageSize! : 20;

  return { page, pageSize: Math.min(requestedSize, MAX_PAGE_SIZE) };
}

export function offsetFor(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}

export function buildPage<T>(items: T[], request: PageRequest, totalItems: number): Page<T> {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / request.pageSize);

  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    totalItems,
    totalPages,
  };
}
