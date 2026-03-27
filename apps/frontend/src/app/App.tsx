import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AppProvider } from './context/app-context';
import { Toaster } from './components/ui/sonner';

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
      <Toaster position="top-right" />
    </AppProvider>
  );
}