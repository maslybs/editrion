// Simple observer pattern implementation for state management
export type Listener<T> = (state: T) => void;
export type Unsubscribe = () => void;

export class BaseStore<T> {
  private state: T;
  private listeners: Set<Listener<T>> = new Set();

  constructor(initialState: T) {
    this.state = initialState;
  }

  getState(): T {
    return this.state;
  }

  setState(newState: Partial<T>): void {
    this.state = { ...this.state, ...newState };
    this.notifyListeners();
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  // Helper for computed values
  select<U>(selector: (state: T) => U): U {
    return selector(this.state);
  }
}