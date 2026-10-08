import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '@/lib/api';

const WizardContext = createContext(null);

const INIT = {
  step: 0, maxStep: 0,

  // Header context
  importType: 'stock',
  branchId: 'BMS10004',
  region: 'en-IN',
  lang: 'en',

  // Source
  source: 'file',
  dbMode: 'running',

  // Config (for batch creation)
  config: {
    importType: 'STOCK',
    postMode: 'LEGACY',
    purchaseAccount: '',
    dateOrder: 'DMY',
    numberStyle: 'DOT',
    region: 'en-IN',
    dupKeyColumns: 'OEMCode',
    dupMode: 'ERROR',
    chunkSize: 50000,
    remarks: '',
  },

  // Source parse options
  parseOpts: {
    delim: 'auto',
    encoding: 'UTF-8',
    srcDateFmt: 'auto',
    srcNumFmt: 'auto',
  },

  // Batch
  batchId: null,

  // File data
  file: null,
  columns: [],
  rows: [],
  colStats: [],
  firstRowHeader: true,

  // Mapping (Step 3)
  columnMapping: {},
  transforms: {},
  defaults: {},
  applyDefaults: true,

  // Masters from API
  masters: null,
  apiHealth: null,

  // Suppliers (Step 4)
  suppliersData: {
    mode: 'column',
    suppliers: [],
    singleName: '',
    singleExisting: '',
    singleGstin: '',
    singleOutstanding: '0',
    singleDrCr: 'Cr',
    supCols: [],
    supRows: [],
    supMap: {},
    supFile: null,
    ledger: {
      create: true,
      group: 'Sundry Creditors',
      glType: 'S',
      obDate: '',
      ifExists: 'keep',
    },
    resolution: {},
  },

  // Master mapping (Step 5)
  masterMapData: {
    resolution: {},
    masterMap: null,
    initialized: false,
  },

  // Validation (Step 6)
  validateData: null,
  profile: 'generic',
  skipErrors: true,

  // Confirm options (Step 7)
  confirmOpts: {
    dupPolicy: 'update',
    postMode: 'Post immediately',
    purAcc: '',
    chunkSize: 50000,
    remarks: '',
    confirmed: false,
  },

  // Import (Step 8)
  imp: { batchId: null, running: false, log: [], chunks: [], ok: 0, fail: 0, skip: 0, started: null, ended: null, cancelled: false },

  // Global action bar state (set by each step)
  nav: {
    backEnabled: true,
    nextEnabled: false,
    nextLabel: 'Continue →',
    statusText: '',
  },
};

export function WizardProvider({ children }) {
  const [ws, setWs] = useState(INIT);
  // nextHandlerRef: each step can set a custom async next handler
  const nextHandlerRef = useRef(null);

  const patch = useCallback((u) => setWs(p => {
    const n = { ...p, ...u };
    if (u.step !== undefined && u.step > p.maxStep) n.maxStep = u.step;
    return n;
  }), []);

  const reset = useCallback(() => {
    nextHandlerRef.current = null;
    setWs(INIT);
  }, []);

  const setNextHandler = useCallback((fn) => {
    nextHandlerRef.current = fn;
  }, []);

  const goNext = useCallback(() => {
    setWs(p => {
      const next = p.step + 1;
      return { ...p, step: next, maxStep: Math.max(p.maxStep, next) };
    });
  }, []);

  const goPrev = useCallback(() => {
    setWs(p => ({ ...p, step: Math.max(0, p.step - 1) }));
  }, []);

  const handleNext = useCallback(() => {
    if (nextHandlerRef.current) {
      nextHandlerRef.current();
    } else {
      goNext();
    }
  }, [goNext]);

  // Load API health + masters on mount
  useEffect(() => {
    api.get('/health').then(({ data: h }) => {
      setWs(p => ({ ...p, apiHealth: h }));
      if (h.connected) {
        api.get('/masters').then(({ data: m }) => {
          setWs(p => ({ ...p, masters: m.masters || m }));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  return (
    <WizardContext.Provider value={{ ws, patch, reset, goNext, goPrev, handleNext, setNextHandler }}>
      {children}
    </WizardContext.Provider>
  );
}

export const useWizard = () => useContext(WizardContext);
