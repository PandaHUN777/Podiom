package main

import (
	"testing"
	"time"

	"github.com/Podiom/Podiom/internal/store"
)

func TestLastDreamLabel(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name  string
		dream *store.Dream
		want  string
	}{
		{name: "nil dream", want: "never"},
		{name: "invalid timestamp", dream: &store.Dream{RanAt: "not-a-timestamp"}, want: "not-a-timestamp"},
		{name: "under a minute", dream: &store.Dream{RanAt: now.Add(-3 * time.Second).Format(time.RFC3339)}, want: "just now"},
		{name: "minutes", dream: &store.Dream{RanAt: now.Add(-5 * time.Minute).Format(time.RFC3339)}, want: "5m ago"},
		{name: "hours", dream: &store.Dream{RanAt: now.Add(-90 * time.Minute).Format(time.RFC3339)}, want: "1h ago"},
		{name: "days", dream: &store.Dream{RanAt: now.Add(-48 * time.Hour).Format(time.RFC3339)}, want: "2d ago"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := lastDreamLabel(tt.dream); got != tt.want {
				t.Errorf("lastDreamLabel(%+v) = %q, want %q", tt.dream, got, tt.want)
			}
		})
	}
}
