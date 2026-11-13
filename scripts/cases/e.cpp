#include <iostream>
using namespace std;
class Node {
public:
    int data;
    Node* next;
    Node(int d) { data = d; next = NULL; }
};
class LinkedList {
    Node* head;
public:
    LinkedList() { head = NULL; }
    void insert(int d) {
        Node* n = new Node(d);
        if (!head) { head = n; return; }
        Node* t = head;
        while (t->next) t = t->next;
        t->next = n;
    }
    void display() {
        for (Node* t = head; t; t = t->next) cout << t->data << "->";
        cout << "NULL\n";
    }
    ~LinkedList() {
        Node* c = head;
        while (c != NULL) { Node* nx = c->next; delete c; c = nx; }
    }
};
int main() {
    LinkedList l;
    l.insert(1); l.insert(2); l.insert(3);
    l.display();
    return 0;
}
