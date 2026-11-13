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
    group: 'القوائم المترابطة',
    title: 'قائمة مترابطة: Add و AddFirst (كودك L2)',
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
    group: 'المؤشرات',
    title: 'أساسيات المؤشرات: & و *',
    code: r`#include <iostream>
using namespace std;

int main() {
    int x = 10;
    int y = 20;

    int* p = &x;      // p يحمل عنوان x
    cout << *p << endl;

    *p = 99;          // تعديل x عبر المؤشر
    p = &y;           // الآن p يشير إلى y
    *p = *p + 1;

    int** pp = &p;    // مؤشر إلى مؤشر
    **pp = 0;

    int* q = nullptr;
    q = p;            // مؤشران لنفس المكان

    cout << x << " " << y << endl;
    return 0;
}`,
  },
  {
    id: 'swap',
    group: 'المؤشرات',
    title: 'تبديل قيمتين: بالمؤشرات وبالمرجع (reference)',
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

void noSwap(int a, int b){   // نسخ فقط! لن يتغير شيء
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
    group: 'المؤشرات',
    title: 'مصفوفة ومؤشر يتحرك عليها',
    code: r`#include <iostream>
using namespace std;

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    int* p = arr;          // اسم المصفوفة = عنوان أول عنصر

    for (int i = 0; i < 5; i++) {
        cout << *p << " ";
        p++;               // الانتقال للعنصر التالي
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
    group: 'الذاكرة الديناميكية',
    title: 'new و delete والمؤشر المعلّق (dangling)',
    code: r`#include <iostream>
using namespace std;

int main() {
    int* a = new int(7);       // حجز int في الـ Heap
    int* b = a;                // b يشير لنفس المكان

    *b = 42;
    cout << *a << endl;

    delete a;                  // تحرير الذاكرة
    // الآن a و b كلاهما مؤشر معلّق (dangling)!
    a = nullptr;               // الحل الصحيح

    int* arr = new int[4];     // مصفوفة ديناميكية
    for (int i = 0; i < 4; i++)
        arr[i] = i * i;
    delete[] arr;
    arr = nullptr;

    int* leak = new int(5);    // لن نحررها: تسرب ذاكرة
    leak = new int(6);         // فقدنا العنوان القديم!

    cout << *b << endl;        // خطأ: استخدام ذاكرة محررة
    return 0;
}`,
  },
  {
    id: 'recursion',
    group: 'الدوال',
    title: 'التكرار (Recursion): المضروب factorial',
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
    group: 'القوائم المترابطة',
    title: 'عكس قائمة مترابطة (prev / curr / next)',
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
    group: 'القوائم المترابطة',
    title: 'حذف عقدة من القائمة مع delete',
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
    if (curr == nullptr) return;     // غير موجود
    if (prev == nullptr)
        head = curr->next;           // حذف الأول
    else
        prev->next = curr->next;     // تخطي العقدة
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
    group: 'القوائم المترابطة',
    title: 'قائمة مترابطة مزدوجة (Doubly Linked List)',
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
    group: 'هياكل البيانات',
    title: 'Stack باستخدام قائمة مترابطة (push / pop)',
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
    group: 'هياكل البيانات',
    title: 'Queue دائري داخل class (مصفوفة)',
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
    group: 'هياكل البيانات',
    title: 'شجرة بحث ثنائية (BST) — إدراج بالتكرار',
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
    group: 'أساسيات',
    title: 'vector و string و حلقة for-each',
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

    for (int& x : nums)   // مرجع: يعدّل الأصل
        x = x * 10;

    string name = "Ali";
    name += "!";
    cout << name << " sum=" << sum << endl;
    return 0;
}`,
  },
  {
    id: 'cin',
    group: 'أساسيات',
    title: 'الإدخال cin — قائمة من المستخدم',
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
