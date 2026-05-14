import { QueryClient } from '@tanstack/react-query';

// Crear el cliente una sola vez
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 1000 * 60 * 5,
        },
    },
});
