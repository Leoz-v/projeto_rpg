import { Lobby } from './components/Lobby';
import { TableScreen } from './components/TableScreen';
import { useTable } from './store/table';

export function App() {
  const table = useTable();
  switch (table.status) {
    case 'loading':
      return <main className="lobby" aria-busy />;
    case 'lobby':
      return <Lobby notice={table.notice} />;
    case 'table':
      return <TableScreen view={table.view} />;
  }
}
