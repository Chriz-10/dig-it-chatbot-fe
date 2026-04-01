import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isLoading?: boolean;
  streaming?: boolean;
}

export interface ChatHistoryItem {
  id: number;
  user_message: string;
  ai_message: string;
  created_date: string;
}

interface WebSocketMessage {
  type: 'connection' | 'start' | 'chunk' | 'end' | 'error';
  content?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private ws: WebSocket | null = null;
  private wsUrl = 'ws://127.0.0.1:8000/ws/chat/';
  private apiUrl = 'http://127.0.0.1:8000/api';
  private messageSubject = new Subject<{ type: string; content: string }>();

  constructor(private http: HttpClient) {
    this.connect();
  }

  private connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        
        if (data.type === 'chunk') {
          this.messageSubject.next({ type: 'chunk', content: data.content ?? '' });
        } else if (data.type === 'end') {
          this.messageSubject.next({ type: 'end', content: '' });
        } else if (data.type === 'error') {
          this.messageSubject.next({ type: 'error', content: data.message || 'Unknown error' });
        } else if (data.type === 'connection') {
          console.log('Connection established:', data.message);
        } else if (data.type === 'start') {
          this.messageSubject.next({ type: 'start', content: '' });
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.messageSubject.next({ type: 'error', content: 'WebSocket connection error' });
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Don't auto-reconnect - we'll reconnect manually when needed
    };
  }

  sendMessage(message: string, model: string = 'meta-llama/Llama-3.1-8B-Instruct'): Observable<{ type: string; content: string }> {
    return new Observable(observer => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket not connected, attempting to reconnect...');
        this.connect();
        
        // Wait for connection to establish
        const checkInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            this.sendMessageInternal(message, model, observer);
          }
        }, 100);
        
        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            observer.error('Failed to establish WebSocket connection');
          }
        }, 5000);
      } else {
        this.sendMessageInternal(message, model, observer);
      }
    });
  }

  private sendMessageInternal(message: string, model: string, observer: any) {
    const subscription = this.messageSubject.subscribe({
      next: (data) => {
        observer.next(data);
        if (data.type === 'end' || data.type === 'error') {
          subscription.unsubscribe();
          observer.complete();
        }
      },
      error: (error) => {
        subscription.unsubscribe();
        observer.error(error);
      }
    });

    // Send the message to the WebSocket server
    const payload = {
      model: model,
      prompt: message
    };
    
    console.log('Sending message via WebSocket:', payload);
    this.ws!.send(JSON.stringify(payload));

    // Cleanup subscription when observable completes
    return () => subscription.unsubscribe();
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  interruptStream() {
    console.log('Interrupting stream - closing WebSocket');
    if (this.ws) {
      // Close the connection to stop receiving data from backend
      this.ws.close();
      this.ws = null;
    }
    // Reconnect immediately for next message
    setTimeout(() => this.connect(), 100);
  }

  getChatHistory(): Observable<{ success: boolean; count: number; chats: ChatHistoryItem[] }> {
    return this.http.get<{ success: boolean; count: number; chats: ChatHistoryItem[] }>(
      `${this.apiUrl}/chat-list`
    );
  }
}
