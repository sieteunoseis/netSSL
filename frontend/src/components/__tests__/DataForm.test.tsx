import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataForm from '../DataForm';

// Mock the config context
vi.mock('../../config/ConfigContext', () => ({
  useConfig: () => ({
    config: [
      {
        name: 'name',
        type: 'TEXT',
        validator: { name: 'isAscii', options: '' }
      },
      {
        name: 'hostname',
        type: 'TEXT',
        validator: { name: 'isFQDN', options: { allow_numeric_tld: true } }
      }
    ]
  })
}));

// Mock toast
vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

const mockOnDataAdded = vi.fn();

describe('DataForm', () => {
  it('renders form fields based on config', () => {
    render(<DataForm onDataAdded={mockOnDataAdded} />);
    
    expect(screen.getByPlaceholderText(/name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/hostname/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add connection/i })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    const user = userEvent.setup();
    render(<DataForm onDataAdded={mockOnDataAdded} />);
    
    const submitButton = screen.getByRole('button', { name: /add connection/i });
    await user.click(submitButton);
    
    expect(mockOnDataAdded).not.toHaveBeenCalled();
  });

  it('submets form with valid data', async () => {
    const user = userEvent.setup();
    render(<DataForm onDataAdded={mockOnDataAdded} />);
    
    await user.type(screen.getByPlaceholderText(/name/i), 'TestConnection');
    await user.type(screen.getByPlaceholderText(/hostname/i), 'example.com');
    
    const submitButton = screen.getByRole('button', { name: /add connection/i });
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(mockOnDataAdded).toHaveBeenCalled();
    });
  });
});