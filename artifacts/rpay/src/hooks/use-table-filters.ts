import { useState } from "react";

export interface TableFilters {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}

export interface UseTableFiltersReturn extends TableFilters {
  setSearch: (v: string) => void;
  setStatus: (v: string) => void;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  setPage: (v: number) => void;
  resetPage: () => void;
  clearFilters: () => void;
  hasFilters: boolean;
}

export function useTableFilters(defaultStatus = "all"): UseTableFiltersReturn {
  const [search, setSearchRaw] = useState("");
  const [status, setStatusRaw] = useState(defaultStatus);
  const [dateFrom, setDateFromRaw] = useState("");
  const [dateTo, setDateToRaw] = useState("");
  const [page, setPage] = useState(1);

  const resetPage = () => setPage(1);

  const setSearch = (v: string) => { setSearchRaw(v); resetPage(); };
  const setStatus = (v: string) => { setStatusRaw(v); resetPage(); };
  const setDateFrom = (v: string) => { setDateFromRaw(v); resetPage(); };
  const setDateTo = (v: string) => { setDateToRaw(v); resetPage(); };

  const clearFilters = () => {
    setSearchRaw("");
    setStatusRaw(defaultStatus);
    setDateFromRaw("");
    setDateToRaw("");
    setPage(1);
  };

  const hasFilters = !!(search || (status && status !== defaultStatus) || dateFrom || dateTo);

  return {
    search, status, dateFrom, dateTo, page,
    setSearch, setStatus, setDateFrom, setDateTo, setPage,
    resetPage, clearFilters, hasFilters,
  };
}
