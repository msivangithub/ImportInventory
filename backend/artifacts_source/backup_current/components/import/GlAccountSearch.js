import { useState, useEffect, useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Check, Database, AlertCircle, Loader2 } from 'lucide-react';
import api from '@/lib/api';

export default function GlAccountSearch({ value, onSelect, compId, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(null);
  const [label, setLabel] = useState('');
  const debounce = useRef(null);

  // Load items on open or query change
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/lookup/glaccounts', {
          params: { q: query || '', compId: compId || '' }
        });
        setItems(data.items || []);
        setSource(data.source);
      } catch { setItems([]); }
      finally { setLoading(false); }
    }, query ? 250 : 0);
    return () => clearTimeout(debounce.current);
  }, [query, open, compId]);

  // Sync label from items or value
  useEffect(() => {
    if (!value) { setLabel(''); return; }
    const found = items.find(i => i.id === value);
    setLabel(found ? `${found.id} — ${found.name}` : value);
  }, [value, items]);

  const handleSelect = (item) => {
    onSelect(item.id, item);
    setLabel(`${item.id} — ${item.name}`);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox"
          aria-expanded={open} disabled={disabled}
          className="w-full justify-between h-9 text-sm border-slate-200 font-normal text-left hover:bg-slate-50"
          data-testid="gl-account-search-trigger"
        >
          <span className={label ? 'font-mono text-xs text-slate-800 truncate' : 'text-slate-400'}>
            {label || 'Search purchase account…'}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 text-slate-400 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0 shadow-lg border-slate-200" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type GL ID or account name…"
            value={query}
            onValueChange={setQuery}
            className="text-sm h-9"
            data-testid="gl-account-search-input"
          />
          {source && (
            <div className={`px-3 py-1.5 border-b flex items-center gap-1.5 text-xs font-medium
              ${source === 'live'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
              {source === 'live'
                ? <><Database className="w-3 h-3 shrink-0" /> Connected to SQL Server — live GL accounts</>
                : <><AlertCircle className="w-3 h-3 shrink-0" /> Demo data — set MSSQL_SERVER in environment for live accounts</>}
            </div>
          )}
          <CommandList className="max-h-60">
            <CommandEmpty>
              {loading
                ? <span className="flex items-center justify-center gap-2 text-xs text-slate-400 py-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
                  </span>
                : <span className="text-xs text-slate-400">No accounts found</span>}
            </CommandEmpty>
            <CommandGroup>
              {items.map(item => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => handleSelect(item)}
                  className="gap-2 cursor-pointer text-sm py-2"
                  data-testid={`gl-option-${item.id}`}
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 ${value === item.id ? 'text-emerald-600' : 'opacity-0'}`} />
                  <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                    {item.id}
                  </span>
                  <span className="text-slate-700 truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
