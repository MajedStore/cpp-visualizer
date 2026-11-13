export interface Example {
  id: string;
  title: string;
  group: string;
  code: string;
  input?: string;
}

const r = String.raw;

export const EXAMPLES: Example[] = [
  {
    id: 'linked-list-l2',
    group: 'Linked lists',
    title: 'Linked list: Add / AddFirst',
    code: r`#include <iostream>
using namespace std;

struct Node{
    int value;
    Node* Next;

    Node(){
        value = 0;
    }
    Node(int va){
        value = va;
    }
};

Node* head = nullptr;

void Add(int a){
    Node* newnode = new Node(a);
    if (head == nullptr){
        head = newnode;
        newnode->Next = nullptr;
    }else{
        Node* Current;
        Current = head;
        while(Current->Next != nullptr){
            Current = Current->Next;
        }
        Current->Next = newnode;
        newnode->Next = nullptr;
    }
}

void AddFirst(int a){
    Node* newnode = new Node(a);
    newnode->Next = head;
    head = newnode;
}

void Print(){
    while(head != nullptr){
        cout<<head->value<<" ";
        head = head->Next;
    }
}

int main (){
    Add(10);
    Add(20);
    Add(30);
    AddFirst(60);
    Print();
    return 0;
}`,
  },
  {
    id: 'pointer-basics',
    group: 'Pointers',
    title: 'Pointer basics: & and *',
    code: r`#include <iostream>
using namespace std;

int main() {
    int x = 10;
    int y = 20;

    int* p = &x;      // p holds the address of x
    cout << *p << endl;

    *p = 99;          // change x through p
    p = &y;           // p now points to y
    *p = *p + 1;

    int** pp = &p;    // pointer to pointer
    **pp = 0;

    int* q = nullptr;
    q = p;            // two pointers, same target

    cout << x << " " << y << endl;
    return 0;
}`,
  },
  {
    id: 'swap',
    group: 'Pointers',
    title: 'Swap: pointers vs references',
    code: r`#include <iostream>
using namespace std;

void swapPtr(int *a, int *b){
    int temp = *a;
    *a = *b;
    *b = temp;
}

void swapRef(int &a, int &b){
    int temp = a;
    a = b;
    b = temp;
}

void noSwap(int a, int b){   // copies only, nothing changes
    int temp = a;
    a = b;
    b = temp;
}

int main() {
    int x = 5;
    int y = 19;

    noSwap(x, y);
    swapPtr(&x, &y);
    swapRef(x, y);

    cout << x << " " << y << endl;
    return 0;
}`,
  },
  {
    id: 'array-pointer',
    group: 'Pointers',
    title: 'Array and moving pointer',
    code: r`#include <iostream>
using namespace std;

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    int* p = arr;          // array name = address of first element

    for (int i = 0; i < 5; i++) {
        cout << *p << " ";
        p++;               // move to next element
    }
    cout << endl;

    p = &arr[2];
    *(p + 1) = 400;        // arr[3]
    p[-1] = 200;           // arr[1]

    int size = sizeof(arr) / sizeof(arr[0]);
    cout << "size = " << size << endl;
    return 0;
}`,
  },
  {
    id: 'new-delete',
    group: 'Dynamic memory',
    title: 'new, delete and dangling pointers',
    code: r`#include <iostream>
using namespace std;

int main() {
    int* a = new int(7);       // allocate an int on the heap
    int* b = a;                // b points to the same place

    *b = 42;
    cout << *a << endl;

    delete a;                  // free the memory
    // a and b are now dangling!
    a = nullptr;               // the fix

    int* arr = new int[4];     // dynamic array
    for (int i = 0; i < 4; i++)
        arr[i] = i * i;
    delete[] arr;
    arr = nullptr;

    int* leak = new int(5);    // never freed: leak
    leak = new int(6);         // old address lost!

    cout << *b << endl;        // error: use after free
    return 0;
}`,
  },
  {
    id: 'recursion',
    group: 'Functions',
    title: 'Recursion: factorial',
    code: r`#include <iostream>
using namespace std;

int fac(int n){
    if (n == 0)
        return 1;
    int rest = fac(n - 1);
    return n * rest;
}

int main (){
    int n = 4;
    int result = fac(n);
    cout << n << "! = " << result << endl;
    return 0;
}`,
  },
  {
    id: 'reverse-list',
    group: 'Linked lists',
    title: 'Reverse a linked list',
    code: r`#include <iostream>
using namespace std;

struct Node {
    int data;
    Node* next;
    Node(int d) {
        data = d;
        next = nullptr;
    }
};

Node* reverse(Node* head) {
    Node* prev = nullptr;
    Node* curr = head;
    while (curr != nullptr) {
        Node* next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }
    return prev;
}

int main() {
    Node* head = new Node(1);
    head->next = new Node(2);
    head->next->next = new Node(3);
    head->next->next->next = new Node(4);

    head = reverse(head);

    for (Node* t = head; t != nullptr; t = t->next)
        cout << t->data << " ";
    return 0;
}`,
  },
  {
    id: 'delete-node',
    group: 'Linked lists',
    title: 'Delete a node',
    code: r`#include <iostream>
using namespace std;

struct Node {
    int value;
    Node* next;
};

Node* head = nullptr;

void pushFront(int v) {
    Node* n = new Node;
    n->value = v;
    n->next = head;
    head = n;
}

void removeValue(int v) {
    Node* curr = head;
    Node* prev = nullptr;
    while (curr != nullptr && curr->value != v) {
        prev = curr;
        curr = curr->next;
    }
    if (curr == nullptr) return;     // not found
    if (prev == nullptr)
        head = curr->next;           // remove head
    else
        prev->next = curr->next;     // skip the node
    delete curr;
}

int main() {
    pushFront(30);
    pushFront(20);
    pushFront(10);
    removeValue(20);
    removeValue(10);
    return 0;
}`,
  },
  {
    id: 'doubly',
    group: 'Linked lists',
    title: 'Doubly linked list',
    code: r`#include <iostream>
using namespace std;

struct Node {
    int val;
    Node* prev;
    Node* next;
    Node(int v) : val(v), prev(nullptr), next(nullptr) {}
};

Node* head = nullptr;
Node* tail = nullptr;

void pushBack(int v) {
    Node* n = new Node(v);
    if (tail == nullptr) {
        head = tail = n;
        return;
    }
    tail->next = n;
    n->prev = tail;
    tail = n;
}

int main() {
    pushBack(1);
    pushBack(2);
    pushBack(3);
    for (Node* p = tail; p != nullptr; p = p->prev)
        cout << p->val << " ";
    return 0;
}`,
  },
  {
    id: 'stack-ll',
    group: 'Data structures',
    title: 'Stack (linked list)',
    code: r`#include <iostream>
using namespace std;

struct Node {
    int data;
    Node* below;
};

class Stack {
private:
    Node* top;
    int count;
public:
    Stack() {
        top = nullptr;
        count = 0;
    }
    void push(int x) {
        Node* n = new Node;
        n->data = x;
        n->below = top;
        top = n;
        count++;
    }
    int pop() {
        if (top == nullptr) return -1;
        Node* old = top;
        int x = old->data;
        top = top->below;
        delete old;
        count--;
        return x;
    }
};

int main() {
    Stack s;
    s.push(5);
    s.push(8);
    s.push(13);
    cout << s.pop() << endl;
    cout << s.pop() << endl;
    return 0;
}`,
  },
  {
    id: 'circular-queue',
    group: 'Data structures',
    title: 'Circular queue (array)',
    code: r`#include <iostream>
using namespace std;

const int MAX = 5;

class CircularQueue {
private:
    int data[MAX];
    int front;
    int rear;
    int count;
public:
    CircularQueue() {
        front = 0;
        rear = -1;
        count = 0;
    }
    void enqueue(int value) {
        if (count == MAX) {
            cout << "Queue is full!\n";
            return;
        }
        rear = (rear + 1) % MAX;
        data[rear] = value;
        count++;
    }
    int dequeue() {
        if (count == 0) return -1;
        int value = data[front];
        front = (front + 1) % MAX;
        count--;
        return value;
    }
};

int main() {
    CircularQueue q;
    q.enqueue(10);
    q.enqueue(20);
    q.enqueue(30);
    cout << q.dequeue() << endl;
    q.enqueue(40);
    return 0;
}`,
  },
  {
    id: 'bst',
    group: 'Data structures',
    title: 'Binary search tree',
    code: r`#include <iostream>
using namespace std;

struct TreeNode {
    int key;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int k) {
        key = k;
        left = nullptr;
        right = nullptr;
    }
};

TreeNode* insert(TreeNode* root, int k) {
    if (root == nullptr)
        return new TreeNode(k);
    if (k < root->key)
        root->left = insert(root->left, k);
    else
        root->right = insert(root->right, k);
    return root;
}

void inorder(TreeNode* r) {
    if (r == nullptr) return;
    inorder(r->left);
    cout << r->key << " ";
    inorder(r->right);
}

int main() {
    TreeNode* root = nullptr;
    root = insert(root, 50);
    root = insert(root, 30);
    root = insert(root, 70);
    root = insert(root, 20);
    root = insert(root, 40);
    root = insert(root, 80);
    inorder(root);
    return 0;
}`,
  },
  {
    id: 'vector',
    group: 'Basics',
    title: 'vector, string, for-each',
    code: r`#include <iostream>
#include <vector>
#include <string>
using namespace std;

int main() {
    vector<int> nums;
    nums.push_back(3);
    nums.push_back(1);
    nums.push_back(4);

    int sum = 0;
    for (int x : nums)
        sum += x;

    for (int& x : nums)   // reference: edits the original
        x = x * 10;

    string name = "Ali";
    name += "!";
    cout << name << " sum=" << sum << endl;
    return 0;
}`,
  },
  {
    id: 'cin',
    group: 'Basics',
    title: 'cin: build a list from input',
    input: '3\n7\n2\n9\n',
    code: r`#include <iostream>
using namespace std;

struct Node {
    int value;
    Node* next;
};

int main() {
    int n;
    cout << "How many? ";
    cin >> n;

    Node* head = nullptr;
    for (int i = 0; i < n; i++) {
        int v;
        cout << "Value: ";
        cin >> v;
        Node* node = new Node{v, head};
        head = node;
    }

    for (Node* p = head; p; p = p->next)
        cout << p->value << " ";
    return 0;
}`,
  },
];
