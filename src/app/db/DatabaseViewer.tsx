'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Paper, MenuItem, Select, FormControl, InputLabel, 
  Alert, TextField
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridToolbar } from '@mui/x-data-grid';
import { getDatabaseData } from '@/app/actions/db';

export default function DatabaseViewer({ models }: { models: string[] }) {
  const [selectedModel, setSelectedModel] = useState<string>(models[0] || '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [rowCount, setRowCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // Search State
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Pagination State
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 50,
  });

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
        setDebouncedSearch(search);
        setPaginationModel(prev => ({ ...prev, page: 0 })); // Reset to first page on search
    }, 500);
    return () => clearTimeout(handler);
  }, [search]);

  // Fetch Data
  useEffect(() => {
    if (selectedModel) {
      loadData(selectedModel, paginationModel, debouncedSearch);
    }
  }, [selectedModel, paginationModel, debouncedSearch]);

  const loadData = async (model: string, pagination: GridPaginationModel, searchQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      // API expects 1-based page index, DataGrid uses 0-based
      const result = await getDatabaseData(model, pagination.page + 1, pagination.pageSize, searchQuery);
      
      // Ensure each row has an 'id' for DataGrid
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataWithIds = result.data.map((row: any, index: number) => ({
        ...row,
        id: row.id !== undefined ? row.id : `row-${index}`, // Fallback if no ID
      }));

      setData(dataWithIds);
      setRowCount(result.total);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Dynamic Columns
  const columns: GridColDef[] = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).map((key) => ({
      field: key,
      headerName: key.charAt(0).toUpperCase() + key.slice(1),
      flex: 1,
      minWidth: 150,
      renderCell: (params) => {
        const val = params.value;
        if (val === null || val === undefined) return <span className="text-gray-500 italic">null</span>;
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 bg-[#1e293b] p-4 rounded-lg border border-gray-700 flex-wrap">
        <FormControl fullWidth sx={{ maxWidth: 300 }}>
          <InputLabel sx={{ color: '#94a3b8' }}>Select Table</InputLabel>
          <Select
            value={selectedModel}
            label="Select Table"
            onChange={(e) => {
                setSelectedModel(e.target.value);
                setSearch(''); 
                setPaginationModel(p => ({ ...p, page: 0 }));
            }}
            sx={{ 
                color: 'white',
                '.MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#94a3b8' },
            }}
          >
            {models.map((model) => (
              <MenuItem key={model} value={model}>{model}</MenuItem>
            ))}
          </Select>
        </FormControl>

         <TextField
            label="Search (Symbol, Description, etc.)"
            variant="outlined"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ 
                flex: 1, 
                maxWidth: 400,
                input: { color: 'white' },
                label: { color: '#94a3b8' },
                '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#475569' },
                    '&:hover fieldset': { borderColor: '#94a3b8' },
                }
             }}
        />
      </div>

      {error && (
        <Alert severity="error" variant="filled">{error}</Alert>
      )}

      <Paper 
        className="glass-card" 
        sx={{ 
            height: 700, 
            width: '100%', 
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            '& .MuiDataGrid-root': {
                border: 'none',
                color: '#e5e7eb',
            },
            '& .MuiDataGrid-cell': {
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            },
            '& .MuiDataGrid-columnHeaders': {
                backgroundColor: '#0f172a',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#e5e7eb',
                fontWeight: 'bold',
            },
            '& .MuiDataGrid-footerContainer': {
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
            },
            '& .MuiTablePagination-root': {
                color: '#94a3b8',
            },
             '& .MuiButtonBase-root': {
                 color: '#94a3b8',
            }
        }}
      >
        <DataGrid
          rows={data}
          columns={columns}
          loading={loading}
          rowCount={rowCount}
          paginationModel={paginationModel}
          paginationMode="server"
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[20, 50, 100]}
          disableRowSelectionOnClick
          slots={{ toolbar: GridToolbar }}
          slotProps={{
              toolbar: {
                  showQuickFilter: false, // We use custom search
                  printOptions: { disableToolbarButton: true },
                  csvOptions: { disableToolbarButton: false },
                  sx: { color: '#94a3b8', p: 1 }
              }
          }}
        />
      </Paper>
    </div>
  );
}
