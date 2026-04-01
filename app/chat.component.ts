import { Component, ChangeDetectorRef, ViewChild, ElementRef, AfterViewChecked, OnInit, NgZone } from '@angular/core';
import { ChatService, ChatMessage, ChatHistoryItem } from './chat.service';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MarkdownModule } from 'ngx-markdown';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  imports: [CommonModule, MatProgressBarModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MarkdownModule]
})
export class ChatComponent implements AfterViewChecked, OnInit {
  @ViewChild('messagesWrapper') private messagesWrapper!: ElementRef;
  
  messages: ChatMessage[] = [];
  userInput = '';
  loading = false;
  isStreaming = false;
  historyCollapsed = true;
  chatHistories: ChatHistoryItem[] = [];
  loadingHistory = false;
  private streamSubscription: Subscription | null = null;
  private shouldAutoScroll = true;
  private mouseMoving = false;
  private mouseMoveTimeout: any = null;
  private scrollScheduled = false;

  constructor(
    private chatService: ChatService, 
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    this.loadChatHistory();
  }

  loadChatHistory() {
    this.loadingHistory = true;
    this.chatService.getChatHistory().subscribe({
      next: (response) => {
        if (response.success) {
          this.chatHistories = response.chats;
          console.log('Chat history loaded:', this.chatHistories.length, 'chats');
        }
        this.loadingHistory = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading chat history:', error);
        this.loadingHistory = false;
        this.cdr.detectChanges();
      }
    });
  }

  ngAfterViewChecked() {
    // Throttle scroll operations using requestAnimationFrame
    if (this.shouldAutoScroll && !this.mouseMoving && !this.scrollScheduled) {
      this.scrollScheduled = true;
      requestAnimationFrame(() => {
        this.scrollToBottom();
        this.scrollScheduled = false;
      });
    }
  }

  onMouseMove() {
    this.mouseMoving = true;
    
    // Clear existing timeout
    if (this.mouseMoveTimeout) {
      clearTimeout(this.mouseMoveTimeout);
    }
    
    // Set mouseMoving to false after 2 seconds of no movement
    this.mouseMoveTimeout = setTimeout(() => {
      this.mouseMoving = false;
    }, 2000);
  }

  onScroll() {
    if (!this.messagesWrapper) return;
    
    const element = this.messagesWrapper.nativeElement;
    const threshold = 150; // pixels from bottom
    const position = element.scrollTop + element.offsetHeight;
    const height = element.scrollHeight;
    
    // If user scrolled up, disable auto-scroll
    if (height - position > threshold) {
      this.shouldAutoScroll = false;
    } else {
      // If user is near bottom, enable auto-scroll
      this.shouldAutoScroll = true;
    }
  }

  private scrollToBottom(): void {
    try {
      // Only scroll if conditions are met
      if (!this.shouldAutoScroll || this.mouseMoving) {
        return;
      }
      
      if (this.messagesWrapper && this.messagesWrapper.nativeElement) {
        const element = this.messagesWrapper.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) {
      // Silently fail
    }
  }

  private forceScrollToBottom(): void {
    try {
      if (this.messagesWrapper && this.messagesWrapper.nativeElement) {
        const element = this.messagesWrapper.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) {
      // Silently fail
    }
  }

  toggleHistory() {
    this.historyCollapsed = !this.historyCollapsed;
    // Only fetch if data hasn't been loaded yet; otherwise show cached data instantly
    if (!this.historyCollapsed && this.chatHistories.length === 0 && !this.loadingHistory) {
      this.loadChatHistory();
    }
  }

  startNewChat() {
    this.messages = [];
    this.shouldAutoScroll = true;
    // Reload history to get any new saved chats
    this.loadChatHistory();
  }

  loadChat(history: ChatHistoryItem) {
    // Convert history to messages format
    this.messages = [
      { role: 'user', content: history.user_message },
      { role: 'assistant', content: history.ai_message }
    ];
    this.shouldAutoScroll = true;
    this.cdr.detectChanges();
    setTimeout(() => this.forceScrollToBottom(), 100);
  }

  getTruncatedMessage(message: string, maxLength: number = 50): string {
    return message.length > maxLength ? message.substring(0, maxLength) + '...' : message;
  }

  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  useExamplePrompt(prompt: string) {
    // Extract just the text from the prompt (remove icon text)
    const cleanPrompt = prompt.replace(/^"(.*)"$/, '$1');
    this.userInput = cleanPrompt;
    this.cdr.detectChanges();
    // Optionally auto-send the message
    // this.sendMessage();
  }

  sendMessage() {
    if (!this.userInput.trim()) return;
    
    const currentInput = this.userInput;
    this.messages.push({ role: 'user', content: currentInput });
    this.userInput = '';
    this.loading = true;
    this.isStreaming = true;
    
    // Enable auto-scroll for new message
    this.shouldAutoScroll = true;
    
    // Track assistant message index (will be created on first chunk)
    let assistantMessageIndex = -1;
    let updateScheduled = false;
    let isFirstChunk = true;
    
    const scheduleUpdate = () => {
      if (!updateScheduled) {
        updateScheduled = true;
        requestAnimationFrame(() => {
          this.ngZone.run(() => {
            this.cdr.detectChanges();
          });
          updateScheduled = false;
        });
      }
    };
    
    this.streamSubscription = this.chatService.sendMessage(currentInput, 'meta-llama/Llama-3.1-8B-Instruct').subscribe({
      next: (data) => {
        console.log('WebSocket data received:', data);
        
        if (data.type === 'start') {
          // Show "Thinking..." with loading animation
          assistantMessageIndex = this.messages.length;
          this.messages.push({ role: 'assistant', content: '', isLoading: true, streaming: true });
          this.cdr.detectChanges();
        } else if (data.type === 'chunk') {
          // On first chunk, always remove loading and start showing message, even if chunk is empty
          if (assistantMessageIndex !== -1) {
            if (isFirstChunk) {
              this.messages[assistantMessageIndex].isLoading = false;
              isFirstChunk = false;
              this.cdr.detectChanges();
            }
            this.messages[assistantMessageIndex].content += data.content;
          } else {
            // Fallback: create message if somehow start wasn't received
            assistantMessageIndex = this.messages.length;
            this.messages.push({ role: 'assistant', content: data.content, isLoading: false, streaming: true });
            isFirstChunk = false;
            this.cdr.detectChanges();
          }
          // Use smooth batched updates for subsequent chunks
          scheduleUpdate();
        } else if (data.type === 'end') {
          console.log('Stream completed');
          if (assistantMessageIndex !== -1) {
            this.messages[assistantMessageIndex].streaming = false;
          }
          this.loading = false;
          this.isStreaming = false;
          this.cdr.detectChanges();
        } else if (data.type === 'error') {
          console.error('Error from server:', data.content);
          if (assistantMessageIndex === -1) {
            this.messages.push({ role: 'assistant', content: 'Sorry, there was an error: ' + data.content, isLoading: false, streaming: false });
          } else {
            this.messages[assistantMessageIndex].isLoading = false;
            this.messages[assistantMessageIndex].streaming = false;
            this.messages[assistantMessageIndex].content = 'Sorry, there was an error: ' + data.content;
          }
          this.loading = false;
          this.isStreaming = false;
          this.cdr.detectChanges();
        }
      },
      error: (error) => {
        console.error('Error occurred:', error);
        if (assistantMessageIndex === -1) {
          this.messages.push({ role: 'assistant', content: 'Sorry, there was an error processing your request.', isLoading: false, streaming: false });
        } else {
          this.messages[assistantMessageIndex].isLoading = false;
          this.messages[assistantMessageIndex].streaming = false;
          this.messages[assistantMessageIndex].content = 'Sorry, there was an error processing your request.';
        }
        this.loading = false;
        this.isStreaming = false;
        this.cdr.detectChanges();
      },
      complete: () => {
        console.log('Message stream completed');
        this.loading = false;
        this.isStreaming = false;
        this.cdr.detectChanges();
        // Reload history to show the newly saved chat
        setTimeout(() => this.loadChatHistory(), 500);
      }
    });
  }

  interruptStream() {
    console.log('Interrupting stream');
    if (this.streamSubscription) {
      this.streamSubscription.unsubscribe();
      this.streamSubscription = null;
    }
    // Close WebSocket to stop backend from sending more data
    this.chatService.interruptStream();
    this.loading = false;
    this.isStreaming = false;
    this.cdr.detectChanges();
  }

  handleButtonClick() {
    if (this.isStreaming) {
      this.interruptStream();
    } else {
      this.sendMessage();
    }
  }
}
